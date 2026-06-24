import { openai } from '../../../ai/client.js';
import { PM_TURN_SYSTEM, pmTurnUser, ProductFormat } from '../../../ai/prompts.js';
import { PmStateUpdate } from './pm.state.js';

// The dual-purpose per-turn PM call (spec §6/§7): one LLM call returns the
// interviewer's spoken line AND a structured assessment of the candidate's last
// answer AND a state update — enforced by a strict json_schema so it always
// parses (§6.2 "why structured JSON").

const LLM_MODEL = 'gpt-4o';

export type PmNextAction =
  | 'probe_deeper' | 'move_to_next_stage' | 'redirect_missed_stage'
  | 'challenge_assumption' | 'ask_for_specifics' | 'request_prioritization'
  | 'request_summary' | 'wrap_up';

export interface PmTurnAssessment {
  case_stage: string;
  question_intent: string;
  response_quality: number;
  did_answer_question: boolean;
  skills_demonstrated: string[];
  skills_missing: string[];
  specificity_level: 'high' | 'medium' | 'low';
  personal_story_used: boolean;
  user_grounded: boolean;
  notes: string;
}

export interface PmTurnResult {
  response: string;
  turn_assessment: PmTurnAssessment;
  next_action: PmNextAction;
  state_update: PmStateUpdate;
}

// Strict structured-output schema. Nullable fields use anyOf/[type,null] so
// OpenAI strict mode accepts them; every property is required (strict rule).
const PM_TURN_SCHEMA = {
  name: 'pm_turn',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['response', 'turn_assessment', 'next_action', 'state_update'],
    properties: {
      response: { type: 'string' },
      turn_assessment: {
        type: 'object',
        additionalProperties: false,
        required: ['case_stage', 'question_intent', 'response_quality', 'did_answer_question',
          'skills_demonstrated', 'skills_missing', 'specificity_level', 'personal_story_used',
          'user_grounded', 'notes'],
        properties: {
          case_stage: { type: 'string' },
          question_intent: { type: 'string' },
          // NOTE: OpenAI strict structured outputs reject minimum/maximum — the
          // 1-10 range lives in the description instead.
          response_quality: { type: 'integer', description: 'quality of the candidate answer, 1 (poor) to 10 (excellent)' },
          did_answer_question: { type: 'boolean' },
          skills_demonstrated: { type: 'array', items: { type: 'string' } },
          skills_missing: { type: 'array', items: { type: 'string' } },
          specificity_level: { type: 'string', enum: ['high', 'medium', 'low'] },
          personal_story_used: { type: 'boolean' },
          user_grounded: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
      next_action: {
        type: 'string',
        enum: ['probe_deeper', 'move_to_next_stage', 'redirect_missed_stage', 'challenge_assumption',
          'ask_for_specifics', 'request_prioritization', 'request_summary', 'wrap_up'],
      },
      state_update: {
        type: 'object',
        additionalProperties: false,
        required: ['stage_complete', 'new_user_choice', 'new_pain_point', 'new_solution', 'new_metric', 'flag_concern'],
        properties: {
          stage_complete: { type: 'boolean' },
          new_user_choice: { type: ['string', 'null'] },
          new_pain_point: { type: ['string', 'null'] },
          new_solution: { type: ['string', 'null'] },
          new_metric: { type: ['string', 'null'] },
          flag_concern: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'detail', 'severity'],
                properties: {
                  type: { type: 'string' },
                  detail: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
  },
} as const;

export type PmTurnSystemArgs = Parameters<typeof PM_TURN_SYSTEM>[0];

export interface PmTurnArgs {
  system: PmTurnSystemArgs;
  stateBlock: string;
  recentTurns: string;
  transcript: string;
  elapsedMin: number;
  totalMin: number;
}

const NEUTRAL_OPENING: Omit<PmTurnResult, 'response'> = {
  turn_assessment: {
    case_stage: 'clarification', question_intent: 'opening', response_quality: 5,
    did_answer_question: true, skills_demonstrated: [], skills_missing: [],
    specificity_level: 'medium', personal_story_used: false, user_grounded: false, notes: 'opening turn',
  },
  next_action: 'ask_for_specifics',
  state_update: { stage_complete: false, new_user_choice: null, new_pain_point: null, new_solution: null, new_metric: null, flag_concern: null },
};

export async function pmTurn(args: PmTurnArgs): Promise<PmTurnResult> {
  const completion = await openai.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 800,
    response_format: { type: 'json_schema', json_schema: PM_TURN_SCHEMA },
    messages: [
      { role: 'system', content: PM_TURN_SYSTEM(args.system) },
      { role: 'user', content: pmTurnUser({ stateBlock: args.stateBlock, recentTurns: args.recentTurns, transcript: args.transcript, elapsedMin: args.elapsedMin, totalMin: args.totalMin }) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(raw) as PmTurnResult;
    if (!parsed.response) throw new Error('empty response');
    return parsed;
  } catch (err) {
    // Degraded turn: keep the interview alive with a safe probe (§17 ≤5% parse-fail tolerance).
    console.error('pmTurn JSON parse/validation failed:', err, raw.slice(0, 200));
    return {
      response: raw.trim() || "Tell me more about that — what's driving your thinking there?",
      ...NEUTRAL_OPENING,
    };
  }
}
