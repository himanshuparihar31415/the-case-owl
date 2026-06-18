import { Case } from '../../models/Case.js';

// Silent, deterministic supervisor. It reads the transcript and flags the two
// rules the interviewer can't reliably self-enforce in real time: LEADING
// (naming a specific driver the candidate hadn't) and FED_DATA (stating a data
// value the candidate hadn't earned). Zero latency, zero cost. For now it only
// OBSERVES + LOGS — wiring its verdict into the next turn (the nudge) is a
// separate, deliberate step because of the create_response timing constraint.

function normalize(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9%$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Generic case/analytical vocabulary that's fair game — using these isn't
// "leading". Leading is naming a SPECIFIC mechanism (e.g. "channel mix",
// "freight", "payer access"), not generic framework concepts ("market size",
// "growth rate", "market attractiveness").
const GENERIC = new Set([
  'revenue', 'revenues', 'cost', 'costs', 'price', 'pricing', 'market', 'markets',
  'growth', 'profit', 'profits', 'margin', 'margins', 'customer', 'customers',
  'product', 'products', 'volume', 'sales', 'demand', 'supply', 'company',
  'industry', 'competition', 'competitor', 'competitors', 'strategy', 'analysis',
  // generic analytical nouns — asking about these is normal interviewer framing
  'size', 'rate', 'rates', 'share', 'attractiveness', 'landscape', 'fit', 'entry',
  'segment', 'segments', 'segmentation', 'factor', 'factors', 'lever', 'levers',
  'driver', 'drivers', 'risk', 'risks', 'opportunity', 'opportunities', 'value',
  'potential', 'trend', 'trends', 'economics', 'structure',
  'the', 'and', 'for', 'with', 'from', 'into', 'their', 'a', 'an', 'of', 'to',
]);

function collectLabels(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { label?: unknown; insight?: unknown; children?: unknown };
  if (typeof n.label === 'string') out.push(n.label);
  if (Array.isArray(n.children)) for (const c of n.children) collectLabels(c, out);
}

export interface Forbidden { drivers: string[]; data: string[]; }

// Build the per-session forbidden list from the case answer key.
export function buildForbiddenList(caseDoc: InstanceType<typeof Case>): Forbidden {
  const data: string[] = [];
  for (const dp of caseDoc.keyDataPoints ?? []) {
    const v = normalize(dp.value);
    if (v.length >= 2) data.push(v);
  }

  const labels: string[] = [];
  collectLabels(caseDoc.solutionTree, labels);
  const drivers: string[] = [];
  for (const label of labels) {
    const n = normalize(label);
    if (!n) continue;
    const tokens = n.split(' ').filter((t) => !GENERIC.has(t));
    // Keep specific multi-word driver phrases; skip generic/short ones to avoid
    // false-positives on ordinary case vocabulary.
    if (n.split(' ').length >= 2 && tokens.length >= 1 && n.length >= 6) drivers.push(n);
  }
  return { drivers: Array.from(new Set(drivers)), data: Array.from(new Set(data)) };
}

export type Verdict = 'OK' | 'LED' | 'FED_DATA';
export interface CheckResult { verdict: Verdict; term?: string; }

// Did the interviewer's turn name a driver or data value the candidate hadn't?
export function deterministicCheck(
  interviewerText: string,
  candidateHistory: string[],
  forbidden: Forbidden
): CheckResult {
  const said = normalize(interviewerText);
  if (!said) return { verdict: 'OK' };
  const candidateSaid = normalize(candidateHistory.join(' '));

  for (const v of forbidden.data) {
    if (said.includes(v) && !candidateSaid.includes(v)) return { verdict: 'FED_DATA', term: v };
  }
  for (const d of forbidden.drivers) {
    if (said.includes(d) && !candidateSaid.includes(d)) return { verdict: 'LED', term: d };
  }
  return { verdict: 'OK' };
}
