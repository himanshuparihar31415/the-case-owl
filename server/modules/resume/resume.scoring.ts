import type { Asking, DirectorState } from './resume.director.js';
import { coverage, COVERAGE_TARGET } from './resume.director.js';
import type { FullEval } from './resume.evaluator.js';

// One stored row per answer: the evaluation plus where it landed in the interview.
export interface StoredEval extends FullEval {
  answerId: number;
  at: string;
  kind: Asking['kind'];
  entryId: number | null;
  followupCount: number;
}

// RESUME-001 default composition (pending sign-off). Sums to 100.
export const WEIGHTS = { content: 50, confidence: 20, voice: 15, roleFit: 15 } as const;

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A re-evaluation of the same answer (more speech arrived) replaces the earlier row. */
export function latestPerAnswer(evals: StoredEval[]): StoredEval[] {
  const byId = new Map<number, StoredEval>();
  for (const e of evals) byId.set(e.answerId, e);
  return [...byId.values()].sort((a, b) => a.answerId - b.answerId);
}

export interface ScorePart { score10: number | null; weight: number; points: number }

export interface ResumeScore {
  total: number; // 0-100
  parts: Record<'content' | 'confidence' | 'voice' | 'roleFit', ScorePart>;
  coverage: { covered: number; total: number; pct: number; target: number; targetMet: boolean };
  roleBlock: { whyAsked: boolean; domainAsked: number; domainTarget: number; complete: boolean };
  answers: number;
  caveats: string[];
}

export function composeScore(allEvals: StoredEval[], state: DirectorState | undefined): ResumeScore {
  // Greetings and fallbacks carry no signal about the candidate.
  const real = latestPerAnswer(allEvals).filter((e) => !e.smallTalk && !e.fallback);
  const caveats: string[] = [];

  const raw: Record<keyof typeof WEIGHTS, number | null> = {
    content: avg(real.filter((e) => e.substantive).map((e) => e.scores.content)),
    confidence: avg(real.map((e) => e.scores.confidence)),
    voice: avg(real.map((e) => e.scores.voice)),
    roleFit: avg(real.filter((e) => e.roleFit !== null).map((e) => e.roleFit as number)),
  };

  // A component with no evidence is left out and the rest re-weighted, never scored as zero.
  const present = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter((k) => raw[k] !== null);
  const weightSum = present.reduce((a, k) => a + WEIGHTS[k], 0);
  let total = 0;
  const parts = {} as ResumeScore['parts'];
  for (const k of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
    const s = raw[k];
    const points = s !== null && weightSum ? (WEIGHTS[k] * (s / 10) * 100) / weightSum : 0;
    total += points;
    parts[k] = { score10: s === null ? null : round1(s), weight: WEIGHTS[k], points: round1(points) };
  }
  if (raw.roleFit === null) caveats.push('The role-fit questions were not reached, so role fit is not part of this score.');
  if (real.length === 0) caveats.push('Not enough answers were evaluated to score this interview.');
  caveats.push('Voice and confidence are judged from the transcript, pace, fillers and hesitation, not from audio.');

  const cov = state ? coverage(state) : { covered: 0, total: 0, pct: 0, targetMet: false };
  if (state && !cov.targetMet) {
    caveats.push(`Only ${Math.round(cov.pct * 100)}% of your resume was covered (target ${Math.round(COVERAGE_TARGET * 100)}%), so the score reflects part of it.`);
  }

  return {
    total: Math.round(total),
    parts,
    coverage: { covered: cov.covered, total: cov.total, pct: Math.round(cov.pct * 100) / 100, target: COVERAGE_TARGET, targetMet: cov.targetMet },
    roleBlock: state
      ? { ...state.role, complete: state.role.whyAsked && state.role.domainAsked >= state.role.domainTarget }
      : { whyAsked: false, domainAsked: 0, domainTarget: 0, complete: false },
    answers: real.length,
    caveats,
  };
}

/** Compact digest of every evaluation, used as the evidence for the closing feedback. */
export function evalDigest(allEvals: StoredEval[], state: DirectorState | undefined): string {
  const rows = latestPerAnswer(allEvals).filter((e) => !e.smallTalk);
  if (!rows.length) return '(no answers evaluated)';
  return rows.map((e) => {
    const where = e.kind === 'entry' && state && e.entryId !== null ? `entry "${state.entries[e.entryId]?.title ?? e.entryId}"` : e.kind;
    const d = e.delivery;
    return `#${e.answerId} [${where}] content ${e.scores.content}, confidence ${e.scores.confidence}, voice ${e.scores.voice}${e.roleFit !== null ? `, roleFit ${e.roleFit}` : ''}; ownership ${e.ownership}${e.hasNumbers ? ', has numbers' : ''}${e.onTopic ? '' : ', OFF-TOPIC'}; ${d.words} words${d.wpm ? `, ${d.wpm} wpm` : ''}, fillers ${d.fillers}, hedges ${d.hedges}${e.note ? `; note: ${e.note}` : ''}`;
  }).join('\n');
}
