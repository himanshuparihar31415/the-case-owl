import OpenAI from 'openai';
import { env } from '../config/env.js';
import { CaseType, Industry } from '../models/Case.js';
import { TranscriptEntry } from '../models/Session.js';
import { PHARMA_PROFITABILITY_CASE_PROMPT, EXHIBIT_CASE_PROMPT, EXTRACT_CASE_PROMPT, REFERENCE_SKELETON_PROMPT, REFERENCE_BRANCH_PROMPT, POST_INTERVIEW_TREE_PROMPT, PharmaTheme, PRODUCT_CASE_PROMPT, GUESSTIMATE_PROMPT, ProductFormat, HINT_PROMPT, EVALUATION_PROMPT, EvaluationContext, PROGRESS_INSIGHT_PROMPT, ProgressInsightContext } from './prompts.js';

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const TEXT_MODEL = 'gpt-4o';
const EMBED_MODEL = 'text-embedding-3-small';

// Embed a batch of strings (one API call). Used by the report's ideal-answer
// quality gate: the model answer must be substantively DIFFERENT from the
// candidate's (cosine < 0.7), else it's a rephrase, not a teaching example.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => d.embedding as number[]);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Single shared JSON completion. Every generator/evaluator below funnels through
// this — system + user prompt → parsed JSON. `guard` throws if the model hit the
// output cap (a truncated tree/report would otherwise parse-fail silently).
async function jsonChat<T = Record<string, unknown>>(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; guard?: boolean } = {},
): Promise<T> {
  const res = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: opts.temperature ?? 0.5,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
  if (opts.guard && res.choices[0]?.finish_reason === 'length') throw new Error('LLM JSON output truncated (hit the token cap)');
  return JSON.parse(res.choices[0]?.message?.content ?? '{}') as T;
}

async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    temperature: 0.7,
  });
  return response.choices[0]?.message?.content ?? '';
}

// The exhibit/quant case shape produced by both the generalized and the pharma
// generators. openingHook is produced by the generalized generator (pharma omits it).
export interface ExhibitCase {
  title: string;
  difficulty?: number;
  situation: string;
  keyDataPoints?: Array<{ label?: string; value?: string }>;
  openingHook?: { reference: string; bridge: string };
  privateMechanismNote?: string;
  exhibits?: Array<{ id?: number; label?: string; visual?: string; render?: string; chartType?: string; xKey?: string; series?: unknown; chartData?: unknown; data?: string; whenToShow?: string; doNotShowIf?: string; insight?: string }>;
  quant?: { task?: string; whenToShow?: string; derivation?: string; answer?: string };
  answerKey?: string;
  commonWrongTurns?: string[];
  forbiddenTerms?: string[];
}

// Specialized pharma-profitability generator (tuned).
export async function generatePharmaProfitabilityCaseWithAI(difficulty: number, theme: PharmaTheme): Promise<ExhibitCase> {
  return jsonChat<ExhibitCase>(
    'You are a McKinsey pharma case designer. The numbers must reconcile. Return only valid JSON.',
    PHARMA_PROFITABILITY_CASE_PROMPT(difficulty, theme),
    { temperature: 0.5, maxTokens: 10000 },
  );
}

// Generalized exhibit-based generator for every other type/industry.
export async function generateExhibitCaseWithAI(type: CaseType, industry: Industry, difficulty: number): Promise<ExhibitCase> {
  return jsonChat<ExhibitCase>(
    'You are a McKinsey case designer. The numbers must reconcile. Return only valid JSON.',
    EXHIBIT_CASE_PROMPT(type, industry, difficulty),
    { temperature: 0.5, maxTokens: 10000 },
  );
}

// A reconstructed custom case carries the same exhibit shape PLUS the type/
// industry/difficulty inferred from the uploaded source.
export interface ExtractedCase extends ExhibitCase {
  type?: CaseType;
  industry?: Industry;
}

// Reconstruct a structured, exhibit-rich case from raw uploaded material
// (pasted text, PDF text, or a full interview transcript) — faithful to the
// source, neutral candidate-facing prompt, fact base as earned exhibits.
export async function extractCaseFromTranscript(rawText: string): Promise<ExtractedCase> {
  return jsonChat<ExtractedCase>(
    'You reconstruct structured case-interview cases from raw uploads. Be FAITHFUL to the source — never invent figures it does not support. Return only valid JSON.',
    EXTRACT_CASE_PROMPT(rawText),
    { temperature: 0.3, maxTokens: 8000 }, // low temp — faithful extraction, not creative generation
  );
}

// Product-case & guesstimate generators (PM / estimation modules).
export interface ModuleCase {
  title: string;
  difficulty?: number;
  prompt: string;
  openingHook?: { reference: string; bridge: string };
  privateGuide?: string;
  answerKey?: string;
  commonWrongTurns?: string[];
}

export async function generateProductCaseWithAI(format: ProductFormat, difficulty: number): Promise<ModuleCase> {
  return jsonChat<ModuleCase>(
    'You are a senior product-management interviewer. Return only valid JSON.',
    PRODUCT_CASE_PROMPT(format, difficulty),
    { temperature: 0.6, maxTokens: 3000 },
  );
}

export async function generateGuesstimateWithAI(difficulty: number): Promise<ModuleCase> {
  return jsonChat<ModuleCase>(
    'You are an interviewer creating a market-sizing guesstimate. The math must reconcile. Return only valid JSON.',
    GUESSTIMATE_PROMPT(difficulty),
    { temperature: 0.6, maxTokens: 3000 },
  );
}

// Build the reference tree in CHUNKS so the total tree is never bounded by a
// single call's output cap: skeleton (root + top buckets) → expand each bucket
// to full depth in its own call → stitch. Total output across calls can far
// exceed 16k and no single call truncates.
export async function buildReferenceTree(casePackage: string): Promise<Record<string, unknown>> {
  const skeleton = await jsonChat(
    'You build the top of MECE case reference trees (answer keys). Return only valid JSON.',
    REFERENCE_SKELETON_PROMPT(casePackage),
    { temperature: 0.3, maxTokens: 12000, guard: true },
  );
  const buckets = Array.isArray(skeleton.children) ? (skeleton.children as Array<Record<string, unknown>>) : [];
  if (!buckets.length) return skeleton;

  const expanded = await Promise.all(buckets.map(async (b) => {
    try {
      const sub = await jsonChat(
        'You expand ONE branch of a MECE case reference tree to full depth. Keep every field terse. Return only valid JSON.',
        REFERENCE_BRANCH_PROMPT(casePackage, JSON.stringify(b)),
        { temperature: 0.3, maxTokens: 12000, guard: true },
      );
      return sub && sub.id ? sub : b; // fall back to the stub if a branch fails
    } catch (e) {
      console.error('reference-tree branch expand failed (using stub):', e);
      return b;
    }
  }));

  return { ...skeleton, children: expanded };
}

// Stage 3: overlay the candidate's actual journey onto the reference tree.
// Returns { overlays, traversal, summary }.
export async function buildEvaluationTree(referenceTreeJson: string, transcript: string): Promise<Record<string, unknown>> {
  return jsonChat(
    'You are an honest case-interview evaluator overlaying a candidate journey onto a reference tree. No inflation. Return only valid JSON.',
    POST_INTERVIEW_TREE_PROMPT(referenceTreeJson, transcript),
    { temperature: 0.3, maxTokens: 16384, guard: true },
  );
}

export async function generateHintWithAI(transcript: TranscriptEntry[]): Promise<string> {
  const transcriptText = transcript.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join('\n');
  return chat('You are a senior McKinsey partner coaching a candidate. Be concise and coaching.', HINT_PROMPT(transcriptText));
}

// Rich, evidence-based evaluation. Larger output + lower temperature for
// consistency. Returns the parsed JSON object (the report service maps it).
export async function generateEvaluationWithAI(ctx: EvaluationContext): Promise<Record<string, unknown>> {
  return jsonChat(
    'You are an expert, honest McKinsey case interview evaluator. Return only valid JSON.',
    EVALUATION_PROMPT(ctx),
    { temperature: 0.4, maxTokens: 15000 },
  );
}

// Cross-session narrative for the dashboard. Cached by the caller.
export async function generateProgressInsight(ctx: ProgressInsightContext): Promise<Record<string, unknown>> {
  return jsonChat(
    'You are a sharp, honest head case-interview coach. Return only valid JSON.',
    PROGRESS_INSIGHT_PROMPT(ctx),
    { temperature: 0.6, maxTokens: 1500 },
  );
}
