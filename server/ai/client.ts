import OpenAI from 'openai';
import { env } from '../config/env.js';
import { CaseType, Industry } from '../models/Case.js';
import { TranscriptEntry } from '../models/Session.js';
import { CASE_GENERATION_PROMPT, PHARMA_PROFITABILITY_CASE_PROMPT, EXHIBIT_CASE_PROMPT, EXTRACT_CASE_PROMPT, REFERENCE_SKELETON_PROMPT, REFERENCE_BRANCH_PROMPT, POST_INTERVIEW_TREE_PROMPT, PharmaTheme, PRODUCT_CASE_PROMPT, GUESSTIMATE_PROMPT, ProductFormat, HINT_PROMPT, SCORING_PROMPT, EVALUATION_PROMPT, EvaluationContext, PROGRESS_INSIGHT_PROMPT, ProgressInsightContext } from './prompts.js';

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

async function chatJSON<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });
  const text = response.choices[0]?.message?.content ?? '{}';
  return JSON.parse(text) as T;
}

async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function generateCaseWithAI(type: CaseType, industry: Industry, difficulty: number) {
  const prompt = CASE_GENERATION_PROMPT(type, industry, difficulty);
  return chatJSON<{
    title: string;
    description: string;
    scenario: string;
    keyDataPoints: Array<{ label: string; value: string }>;
    questions: string[];
    plausibleSolution?: string;
    solutionTree?: unknown;
    idealScript?: Array<{ stage: string; interviewer: string; idealResponse: string }>;
    openingHook?: { reference: string; bridge: string };
  }>(
    'You are a McKinsey case interview designer. Return only valid JSON.',
    prompt
  );
}

// The exhibit/quant case shape produced by both the generalized and the pharma
// generators. openingHook is produced by the generalized generator (pharma omits it).
export interface ExhibitCase {
  title: string;
  difficulty?: number;
  situation: string;
  openingHook?: { reference: string; bridge: string };
  privateMechanismNote?: string;
  exhibits?: Array<{ id?: number; label?: string; visual?: string; render?: string; chartType?: string; xKey?: string; series?: unknown; chartData?: unknown; data?: string; whenToShow?: string; doNotShowIf?: string; insight?: string }>;
  quant?: { task?: string; whenToShow?: string; derivation?: string; answer?: string };
  answerKey?: string;
  commonWrongTurns?: string[];
  forbiddenTerms?: string[];
}

async function generateExhibitCaseJSON(systemPrompt: string, userPrompt: string): Promise<ExhibitCase> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 6000, // reconciled exhibits + quant derivation; headroom so JSON never truncates
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as ExhibitCase;
}

// Specialized pharma-profitability generator (tuned).
export async function generatePharmaProfitabilityCaseWithAI(difficulty: number, theme: PharmaTheme): Promise<ExhibitCase> {
  return generateExhibitCaseJSON(
    'You are a McKinsey pharma case designer. The numbers must reconcile. Return only valid JSON.',
    PHARMA_PROFITABILITY_CASE_PROMPT(difficulty, theme)
  );
}

// Generalized exhibit-based generator for every other type/industry.
export async function generateExhibitCaseWithAI(type: CaseType, industry: Industry, difficulty: number): Promise<ExhibitCase> {
  return generateExhibitCaseJSON(
    'You are a McKinsey case designer. The numbers must reconcile. Return only valid JSON.',
    EXHIBIT_CASE_PROMPT(type, industry, difficulty)
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
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You reconstruct structured case-interview cases from raw uploads. Be FAITHFUL to the source — never invent figures it does not support. Return only valid JSON.' },
      { role: 'user', content: EXTRACT_CASE_PROMPT(rawText) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3, // low — faithful extraction, not creative generation
    max_tokens: 6000,
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as ExtractedCase;
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
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are a senior product-management interviewer. Return only valid JSON.' },
      { role: 'user', content: PRODUCT_CASE_PROMPT(format, difficulty) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 3000,
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as ModuleCase;
}

export async function generateGuesstimateWithAI(difficulty: number): Promise<ModuleCase> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are an interviewer creating a market-sizing guesstimate. The math must reconcile. Return only valid JSON.' },
      { role: 'user', content: GUESSTIMATE_PROMPT(difficulty) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 3000,
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as ModuleCase;
}

// Stage 2: build the private MECE reference tree (answer key) from a case
// package. Returns the root node (nested JSON). Used by the evaluator.
// One JSON chunk call with a hard truncation guard.
async function genTreeChunk(system: string, user: string): Promise<Record<string, unknown>> {
  const r = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 12000,
  });
  if (r.choices[0]?.finish_reason === 'length') throw new Error('reference-tree chunk truncated');
  return JSON.parse(r.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
}

// Build the reference tree in CHUNKS so the total tree is never bounded by a
// single call's output cap: skeleton (root + top buckets) → expand each bucket
// to full depth in its own call → stitch. Total output across calls can far
// exceed 16k and no single call truncates.
export async function buildReferenceTree(casePackage: string): Promise<Record<string, unknown>> {
  const skeleton = await genTreeChunk(
    'You build the top of MECE case reference trees (answer keys). Return only valid JSON.',
    REFERENCE_SKELETON_PROMPT(casePackage),
  );
  const buckets = Array.isArray(skeleton.children) ? (skeleton.children as Array<Record<string, unknown>>) : [];
  if (!buckets.length) return skeleton;

  const expanded = await Promise.all(buckets.map(async (b) => {
    try {
      const sub = await genTreeChunk(
        'You expand ONE branch of a MECE case reference tree to full depth. Keep every field terse. Return only valid JSON.',
        REFERENCE_BRANCH_PROMPT(casePackage, JSON.stringify(b)),
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
// Returns { tree, summary }.
export async function buildEvaluationTree(referenceTreeJson: string, transcript: string): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are an honest case-interview evaluator overlaying a candidate journey onto a reference tree. No inflation. Return only valid JSON.' },
      { role: 'user', content: POST_INTERVIEW_TREE_PROMPT(referenceTreeJson, transcript) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 16384,
  });
  if (response.choices[0]?.finish_reason === 'length') {
    throw new Error('evaluation overlay exceeded the output limit (truncated)');
  }
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
}

export async function generateHintWithAI(transcript: TranscriptEntry[]): Promise<string> {
  const transcriptText = transcript
    .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
    .join('\n');
  return chat(
    'You are a senior McKinsey partner coaching a candidate. Be concise and coaching.',
    HINT_PROMPT(transcriptText)
  );
}

// Rich, evidence-based evaluation. Larger output + lower temperature for
// consistency. Returns the parsed JSON object (loosely typed — the report
// service maps it into the stored shape).
export async function generateEvaluationWithAI(ctx: EvaluationContext): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are an expert, honest McKinsey case interview evaluator. Return only valid JSON.' },
      { role: 'user', content: EVALUATION_PROMPT(ctx) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 15000, // v2 schema is larger (integrity, anchors, 3-layer ideal answers, 4-part missed opps); headroom so JSON never truncates
  });
  const text = response.choices[0]?.message?.content ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

// Cross-session narrative for the dashboard. Cached by the caller.
export async function generateProgressInsight(ctx: ProgressInsightContext): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: 'You are a sharp, honest head case-interview coach. Return only valid JSON.' },
      { role: 'user', content: PROGRESS_INSIGHT_PROMPT(ctx) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 1500,
  });
  return JSON.parse(response.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
}

export async function generateScoringWithAI(
  transcriptText: string,
  caseTitle: string,
  caseType: string
) {
  return chatJSON<{
    overallScore: number;
    overallGrade: 'STRONG_PASS' | 'PASS' | 'BORDERLINE' | 'FAIL';
    competencies: {
      structure: { score: number; flag?: string };
      math: { score: number; flag?: string };
      businessJudgment: { score: number; flag?: string };
      communication: { score: number; flag?: string };
      creativity: { score: number; flag?: string };
      hypothesis: { score: number; flag?: string };
    };
    feedback: {
      strengths: string[];
      improvements: string[];
      momentsOfExcellence: string[];
      missedOpportunities: string[];
      keyHypotheses: string[];
    };
    executiveSummary: string;
  }>(
    'You are an expert McKinsey case interview evaluator. Return only valid JSON.',
    SCORING_PROMPT(transcriptText, caseTitle, caseType)
  );
}
