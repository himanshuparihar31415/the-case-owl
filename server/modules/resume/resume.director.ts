import type { ResumeBrief } from '../../ai/prompts.js';
import { roleBlockFor } from './resume.roles.js';

// The interview's rules, enforced in code (RESUME-001). The live model only phrases
// questions; this decides WHAT happens next: which resume entry, whether another
// follow-up is allowed, when the role block runs, and when to close. Pure and
// synchronous so it can be unit-tested and persisted as plain JSON.

export const MAX_FOLLOWUPS = 3;          // per thread, hard cap
export const COVERAGE_TARGET = 0.7;      // share of in-scope resume entries that must be covered
const MAX_REDIRECTS = 2;                 // consecutive off-topic redirects before moving on
const MAX_OPENING_TURNS = 4;             // small-talk turns before we force the interview forward
const ROLE_DUE_TIME = 0.45;              // role block becomes due at this share of the time...
const ROLE_DUE_COVERAGE = 0.5;           // ...or at this coverage, whichever comes first
const ROLE_FORCE_TIME = 0.6;             // after this, the role block interrupts an open thread
const EARLY_CLOSE_TIME = 0.6;            // may close early (target met, role done) after this
const CLOSE_TIME = 0.88;                 // always close by here, leaving room for the spoken feedback

// Setup-page topic labels -> the brief's section topics.
const TOPIC_KEY: Record<string, string> = {
  'Work experience': 'work',
  Internships: 'internship',
  'Projects & case work': 'project',
  'Leadership & extracurriculars': 'leadership',
  'Education & motivation': 'education',
};

export type Phase = 'opening' | 'resume' | 'role' | 'closing';
export type EntryStatus = 'untouched' | 'active' | 'covered' | 'exhausted';

export interface EntryState {
  id: number;
  topic: string;
  title: string;
  inScope: boolean;
  status: EntryStatus;
  followups: number;
  substantive: boolean;
}

export type Asking =
  | { kind: 'opening' }
  | { kind: 'entry'; entry: number }
  | { kind: 'role_why' }
  | { kind: 'role_domain' }
  | { kind: 'none' };

export interface DirectorState {
  phase: Phase;
  entries: EntryState[];
  asking: Asking;
  role: { whyAsked: boolean; domainAsked: number; domainTarget: number };
  openingTurns: number;
  offTopicStreak: number;
  answers: number;
}

/** What the silent evaluator concluded about the candidate's latest answer. */
export interface TurnEval {
  smallTalk: boolean;   // greeting / audio check / "yes I can hear you"
  onTopic: boolean;     // answered the question that was asked
  substantive: boolean; // enough substance to judge something
  needsMore: boolean;   // the interviewer still cannot form a judgment on this thread
}

export type Directive =
  | { kind: 'opening' }
  | { kind: 'redirect' }
  | { kind: 'probe'; entry: EntryState; n: number }
  | { kind: 'advance'; entry: EntryState }
  | { kind: 'role_why' }
  | { kind: 'role_domain'; n: number }
  | { kind: 'close' };

export function initDirector(brief: ResumeBrief, topics: string[], durationMinutes: number): DirectorState {
  const wanted = new Set(topics.map((t) => TOPIC_KEY[t]).filter(Boolean));
  const anyMatch = brief.sections.some((s) => wanted.has(s.topic));
  const entries: EntryState[] = brief.sections.map((s, id) => ({
    id,
    topic: s.topic,
    title: s.title,
    // A resume with nothing in the chosen topics still gets interviewed, on everything.
    inScope: anyMatch ? wanted.has(s.topic) : true,
    status: 'untouched',
    followups: 0,
    substantive: false,
  }));
  return {
    phase: 'opening',
    entries,
    asking: { kind: 'opening' },
    role: { whyAsked: false, domainAsked: 0, domainTarget: durationMinutes >= 25 ? 2 : 1 },
    openingTurns: 0,
    offTopicStreak: 0,
    answers: 0,
  };
}

export interface Coverage { covered: number; total: number; pct: number; targetMet: boolean }

export function coverage(state: DirectorState): Coverage {
  const scoped = state.entries.filter((e) => e.inScope);
  const covered = scoped.filter((e) => e.status === 'covered').length;
  const pct = scoped.length ? covered / scoped.length : 1;
  return { covered, total: scoped.length, pct, targetMet: pct >= COVERAGE_TARGET };
}

const roleDone = (s: DirectorState): boolean => s.role.whyAsked && s.role.domainAsked >= s.role.domainTarget;

export interface Clock { elapsedSec: number; totalSec: number }

/**
 * Account for the candidate's answer, then decide what the interviewer does next.
 * Mutates `state` (the caller persists it). The follow-up cap lives here: a probe
 * is only ever returned while the thread has fewer than MAX_FOLLOWUPS.
 */
export function decide(state: DirectorState, ev: TurnEval, clock: Clock): Directive {
  state.answers += 1;
  const f = clock.totalSec > 0 ? clock.elapsedSec / clock.totalSec : 0;

  // ── 1. Account for the answer just given ──
  const a = state.asking;
  if (a.kind === 'opening') {
    if (ev.smallTalk && state.openingTurns < MAX_OPENING_TURNS) {
      state.openingTurns += 1;
      return { kind: 'opening' };
    }
    state.phase = 'resume'; // the background walk-through (or a forced move-on) ends the opening
  } else if (!ev.onTopic && state.offTopicStreak < MAX_REDIRECTS && a.kind !== 'none') {
    state.offTopicStreak += 1;
    return { kind: 'redirect' };
  } else {
    state.offTopicStreak = 0;
    if (a.kind === 'entry') {
      const entry = state.entries[a.entry];
      if (entry) {
        if (ev.substantive) entry.substantive = true;
        const exhausted = entry.followups >= MAX_FOLLOWUPS;
        if (ev.substantive && (!ev.needsMore || exhausted)) entry.status = 'covered';
        else if (exhausted) entry.status = entry.substantive ? 'covered' : 'exhausted';
      }
    } else if (a.kind === 'role_why') {
      state.role.whyAsked = true;
    } else if (a.kind === 'role_domain') {
      state.role.domainAsked += 1;
    }
  }

  // ── 2. Choose what comes next ──
  const cov = coverage(state);
  if (f >= CLOSE_TIME) return closeNow(state);
  if (roleDone(state) && cov.targetMet && f >= EARLY_CLOSE_TIME) return closeNow(state);

  const roleDue = !roleDone(state) && (f >= ROLE_DUE_TIME || cov.pct >= ROLE_DUE_COVERAGE);
  const active = a.kind === 'entry' ? state.entries[a.entry] : undefined;
  const threadOpen = !!active && active.status === 'active' && active.followups < MAX_FOLLOWUPS;

  // The role block waits for the current thread to finish, unless time is running out.
  if (roleDue && (!threadOpen || f >= ROLE_FORCE_TIME)) return askRole(state);

  if (threadOpen && active) {
    active.followups += 1;
    return { kind: 'probe', entry: active, n: active.followups };
  }

  const next = state.entries.find((e) => e.inScope && e.status === 'untouched');
  if (next) {
    next.status = 'active';
    state.asking = { kind: 'entry', entry: next.id };
    state.phase = 'resume';
    return { kind: 'advance', entry: next };
  }

  // Every in-scope entry has been touched: finish the role block, then close.
  if (!roleDone(state)) return askRole(state);
  return closeNow(state);
}

function askRole(state: DirectorState): Directive {
  state.phase = 'role';
  if (!state.role.whyAsked) {
    state.asking = { kind: 'role_why' };
    return { kind: 'role_why' };
  }
  state.asking = { kind: 'role_domain' };
  return { kind: 'role_domain', n: state.role.domainAsked + 1 };
}

function closeNow(state: DirectorState): Directive {
  state.phase = 'closing';
  state.asking = { kind: 'none' };
  return { kind: 'close' };
}

/** Private note injected before the interviewer's next turn. Never read aloud. */
export function directiveText(
  d: Directive,
  ctx: { brief: ResumeBrief; role: string; domain: string; lastQuestion: string; note: string; feedback?: string },
): string {
  const lens = ctx.domain ? ` Judge from the lens of a ${ctx.domain} expert.` : '';
  const hint = ctx.note ? ` (Private observation about their last answer: ${ctx.note})` : '';
  const head = '[PRIVATE DIRECTOR NOTE, never read aloud or mention it] ';
  switch (d.kind) {
    case 'opening':
      return `${head}Continue the natural opening. If you have not yet welcomed them warmly, do it once; respond to small talk like a person. Once they seem settled, ask them to walk you through their background in a minute or two. Do not start probing resume entries yet.`;
    case 'redirect':
      return `${head}Their last answer drifted away from your question. In ONE short, polite sentence bring them back to what you asked ("${ctx.lastQuestion.slice(0, 200)}") and restate it briefly. Give no feedback and no hint about the answer.`;
    case 'advance': {
      const sec = ctx.brief.sections[d.entry.id];
      return `${head}Move to resume entry "${d.entry.title}" [${d.entry.topic}]${sec?.detail ? ` (${sec.detail})` : ''}. Make a natural transition, tying it to something they already told you if you can. Ask ONE question aimed at what THEY personally owned. Claims on the resume to test later: ${sec?.claims.join(' | ') || 'n/a'}. Possible probes: ${sec?.probes.join(' | ') || 'n/a'}.${lens}`;
    }
    case 'probe': {
      const sec = ctx.brief.sections[d.entry.id];
      return `${head}Follow-up ${d.n} of at most ${MAX_FOLLOWUPS} on "${d.entry.title}". Build directly on a specific thing they just said (quote or reference it). Pick the single weakest point you still cannot judge: their own ownership ("I" vs "we"), an unexplained number, or a decision and its trade-off. ONE question only.${hint} Resume claims: ${sec?.claims.join(' | ') || 'n/a'}.${lens}`;
    }
    case 'role_why': {
      const rb = roleBlockFor(ctx.role);
      return `${head}Time for the role question. Transition naturally, then ask ONE conversational question: ${rb.why} Connect it to something from their resume if it fits. Do not call it a "role question".`;
    }
    case 'role_domain': {
      const rb = roleBlockFor(ctx.role);
      const q = rb.domain[(d.n - 1) % rb.domain.length];
      return `${head}Ask ONE role-specific domain question for a ${ctx.role} role, and ask for a concrete example: ${q}${ctx.domain ? ` Fit it to their ${ctx.domain} background where natural.` : ''} Keep it conversational.`;
    }
    case 'close':
      return `${head}The interview is over. Thank them genuinely, then give your end-of-interview feedback in 30 to 45 seconds of natural speech, based on the WHOLE interview: ${ctx.feedback || 'tell them their strongest point and the one or two things to work on most.'} Say a detailed written report is coming next. Ask no further question.`;
  }
}
