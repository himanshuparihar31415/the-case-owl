import OpenAI from 'openai';
import { env } from '../config/env.js';
import { CaseType, Industry } from '../models/Case.js';
import { TranscriptEntry } from '../models/Session.js';
import { PHARMA_PROFITABILITY_CASE_PROMPT, EXHIBIT_CASE_PROMPT, RICH_CASE_CORE_PROMPT, EXHIBIT_RENDER_PROMPT, EXTRACT_CASE_PROMPT, REFERENCE_SKELETON_PROMPT, REFERENCE_BRANCH_PROMPT, POST_INTERVIEW_TREE_PROMPT, PharmaTheme, PRODUCT_CASE_PROMPT, GUESSTIMATE_PROMPT, ProductFormat, HINT_PROMPT, EVALUATION_PROMPT, EvaluationContext, PROGRESS_INSIGHT_PROMPT, ProgressInsightContext } from './prompts.js';

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
  exhibits?: Array<{ id?: number; label?: string; visual?: string; render?: string; chartType?: string; xKey?: string; series?: unknown; chartData?: unknown; columns?: string[]; rows?: string[][]; data?: string; whenToShow?: string; doNotShowIf?: string; insight?: string }>;
  quant?: { task?: string; whenToShow?: string; derivation?: string; answer?: string };
  answerKey?: string;
  commonWrongTurns?: string[];
  forbiddenTerms?: string[];
}

const CASE_SYSTEM = 'You are a McKinsey case designer. The numbers must reconcile. Return only valid JSON.';

// Coerce a value to a finite number, stripping currency/%/commas ("$3.2B"→3.2,
// "72%"→72). Returns null if there's no number in it.
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (m) { const n = parseFloat(m[0]); return Number.isFinite(n) ? n : null; }
  }
  return null;
}

// Make one exhibit safe for the recharts/table renderer: charts get a valid xKey,
// numeric series values, and series whose keys actually exist in the rows; tables
// get string cells. Models routinely emit "72%"/"$3.2B" or mismatched series keys,
// which silently render blank — this repairs them (or downgrades to a table).
function normalizeExhibit(raw: Record<string, unknown>): Record<string, unknown> {
  const e: Record<string, unknown> = { ...raw };

  if (e.render === 'chart' && Array.isArray(e.chartData) && e.chartData.length) {
    const rows = e.chartData as Array<Record<string, unknown>>;
    const first = rows[0] ?? {};
    // Pick the x-axis key: the declared one if present, else the first non-numeric field.
    let xKey = typeof e.xKey === 'string' && e.xKey in first ? e.xKey : '';
    if (!xKey) xKey = Object.keys(first).find((k) => toNum(first[k]) == null) ?? Object.keys(first)[0] ?? 'x';
    const numericKeys = new Set<string>();
    const clean = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === xKey) { out[k] = String(v); continue; }
        const n = toNum(v);
        if (n != null) { out[k] = n; numericKeys.add(k); } else out[k] = v;
      }
      return out;
    });
    let series = Array.isArray(e.series)
      ? (e.series as Array<Record<string, unknown>>).filter((s) => s && numericKeys.has(String(s.key)))
      : [];
    if (!series.length) series = [...numericKeys].map((k) => ({ key: k, label: k }));
    if (series.length) {
      e.xKey = xKey; e.chartData = clean; e.series = series;
    } else {
      // No plottable numeric series — fall back to the text/table view.
      e.render = 'table';
    }
  }

  if (e.render === 'table') {
    if (Array.isArray(e.columns)) e.columns = (e.columns as unknown[]).map((c) => String(c));
    if (Array.isArray(e.rows)) {
      e.rows = (e.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : [String(r)]));
    }
  }
  return e;
}

// Normalize every exhibit on a generated/extracted case in place.
function normalizeCase<T extends ExhibitCase>(c: T): T {
  if (Array.isArray(c.exhibits)) {
    c.exhibits = c.exhibits.map((ex) => normalizeExhibit(ex as Record<string, unknown>)) as T['exhibits'];
  }
  return c;
}

// The core call's shape: the brief + the canonical dataset + the exhibit plan.
type CaseCore = Omit<ExhibitCase, 'exhibits'> & {
  dataset?: unknown;
  exhibitPlan?: Array<Record<string, unknown>>;
};

// Rich TWO-STAGE generator (see prompts.ts): a CORE call fixes the brief + one
// canonical reconciled dataset + an exhibit plan, then EACH planned exhibit is
// rendered in its own call from that shared dataset (dense + reconciling). Falls
// back to the legacy single-call generator if the core call fails or yields no plan.
async function buildRichCase(opts: {
  type: CaseType; industry: Industry; difficulty: number;
  extraGuidance?: string; fallbackPrompt: string;
}): Promise<ExhibitCase> {
  const { type, industry, difficulty, extraGuidance, fallbackPrompt } = opts;
  let core: CaseCore;
  try {
    core = await jsonChat<CaseCore>(
      CASE_SYSTEM, RICH_CASE_CORE_PROMPT(type, industry, difficulty, extraGuidance),
      { temperature: 0.5, maxTokens: 9000, guard: true },
    );
  } catch (e) {
    console.error('rich case core failed; falling back to single-call:', e);
    return normalizeCase(await jsonChat<ExhibitCase>(CASE_SYSTEM, fallbackPrompt, { temperature: 0.5, maxTokens: 10000 }));
  }

  const plan = Array.isArray(core.exhibitPlan) ? core.exhibitPlan : [];
  if (!plan.length) {
    return normalizeCase(await jsonChat<ExhibitCase>(CASE_SYSTEM, fallbackPrompt, { temperature: 0.5, maxTokens: 10000 }));
  }

  // Expand each planned exhibit from the shared dataset, in parallel.
  const datasetJson = JSON.stringify(core.dataset ?? {});
  const title = core.title ?? '';
  const situation = core.situation ?? '';
  const exhibits = await Promise.all(plan.map(async (stub) => {
    try {
      const ex = await jsonChat<Record<string, unknown>>(
        'You render ONE dense case exhibit from a shared canonical dataset. Return only valid JSON.',
        EXHIBIT_RENDER_PROMPT(title, situation, datasetJson, JSON.stringify(stub)),
        { temperature: 0.3, maxTokens: 2500 },
      );
      return ex && (ex.label || ex.data || ex.chartData) ? ex : stub;
    } catch (e) {
      console.error('exhibit render failed (using stub):', e);
      return stub;
    }
  }));

  // Drop the internal-only fields; ship the assembled, normalized case.
  const { dataset: _dataset, exhibitPlan: _plan, ...rest } = core;
  void _dataset; void _plan;
  return normalizeCase({ ...rest, exhibits } as ExhibitCase);
}

// Pharma-specific constraints injected into the rich core call (keeps the tuned
// pharma framing the dedicated single-call prompt had).
const pharmaGuidance = (theme: PharmaTheme): string =>
  `PHARMA SPECIFICS (theme "${theme}"): Net revenue stays roughly FLAT across 5 years — a flat top line hiding a margin problem. The decline traces to ONE pharma mechanism (loss of exclusivity, gross-to-net erosion, payer/channel mix shift, biosimilar entry, R&D productivity decline, mandatory rebate/340B growth, inventory destocking — VARY it to fit the theme) plus one secondary driver. Magnitudes: $1-5B revenue, 60-85% gross margin, R&D 12-20% of revenue, SG&A 20-30%. Build a portfolio of 2-4 named products/franchises with their own dynamics into the dataset.`;

// Specialized pharma-profitability generator (rich two-stage, pharma-tuned).
export async function generatePharmaProfitabilityCaseWithAI(difficulty: number, theme: PharmaTheme): Promise<ExhibitCase> {
  return buildRichCase({
    type: 'profitability', industry: 'pharma', difficulty,
    extraGuidance: pharmaGuidance(theme),
    fallbackPrompt: PHARMA_PROFITABILITY_CASE_PROMPT(difficulty, theme),
  });
}

// Generalized exhibit-based generator for every other type/industry (rich two-stage).
export async function generateExhibitCaseWithAI(type: CaseType, industry: Industry, difficulty: number): Promise<ExhibitCase> {
  return buildRichCase({
    type, industry, difficulty,
    fallbackPrompt: EXHIBIT_CASE_PROMPT(type, industry, difficulty),
  });
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
  return normalizeCase(await jsonChat<ExtractedCase>(
    'You reconstruct structured case-interview cases from raw uploads. Be FAITHFUL to the source — never invent figures it does not support. Return only valid JSON.',
    EXTRACT_CASE_PROMPT(rawText),
    { temperature: 0.3, maxTokens: 8000 }, // low temp — faithful extraction, not creative generation
  ));
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
