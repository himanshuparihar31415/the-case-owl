import OpenAI from 'openai';
import { env } from '../config/env.js';
import { CaseType, Industry } from '../models/Case.js';
import { TranscriptEntry } from '../models/Session.js';
import { CASE_GENERATION_PROMPT, HINT_PROMPT, SCORING_PROMPT, EVALUATION_PROMPT, EvaluationContext, PROGRESS_INSIGHT_PROMPT, ProgressInsightContext } from './prompts.js';

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const TEXT_MODEL = 'gpt-4o';

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
  }>(
    'You are a McKinsey case interview designer. Return only valid JSON.',
    prompt
  );
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
    max_tokens: 12000, // detailed per-competency + improvement-plan prose; headroom so JSON never truncates
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
