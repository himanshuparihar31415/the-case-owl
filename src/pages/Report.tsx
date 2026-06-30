import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle, AlertCircle, AlertTriangle, Loader2, ArrowRight, Download,
  RefreshCw, ChevronDown, FileText, X,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/src/lib/api';

import { ExhibitCard } from '@/src/components/ExhibitCard';

// React-Flow graph is heavy — lazy-load so it only ships when a report renders.
const CaseTree = React.lazy(() => import('@/src/components/CaseTree'));

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ReportData {
  overallScore: number;
  executiveSummary: string;
  analysis?: any;
  metrics?: any;
  progress?: any[];
  competencies?: any;
  feedback?: any;
}

const DECISION_COLOR: Record<string, string> = {
  'No Hire': 'text-error',
  'Lean No': 'text-orange-600',
  Borderline: 'text-amber-600',
  Hire: 'text-on-tertiary-container',
  'Strong Hire': 'text-green-600',
};

// Compact competency pill colour by 0-10 score.
function pillCls(s: number | null): string {
  if (s == null) return 'bg-surface-container text-secondary';
  if (s < 4) return 'bg-error-container text-on-error-container';
  if (s < 6) return 'bg-amber-100 text-amber-800';
  if (s < 8) return 'bg-tertiary-fixed text-on-tertiary-container';
  return 'bg-green-100 text-green-800';
}

// A plain section block (the tab system is gone — the report is one scroll now).
function Block({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-headline text-xl font-bold text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Recursive node for the model solution tree (answer key).
function SolutionNode({ node, depth = 0 }: { node: any; depth?: number }) {
  if (!node) return null;
  const children: any[] = node.children ?? [];
  return (
    <div className={cn(depth > 0 && 'ml-3 pl-4 border-l border-outline-variant/30')}>
      <div className="py-1.5">
        <p className={cn('font-bold text-primary', depth === 0 ? 'text-base' : 'text-sm')}>{node.label}</p>
        {node.insight && <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{node.insight}</p>}
      </div>
      {children.length > 0 && (
        <div className="space-y-1">
          {children.map((c, i) => <React.Fragment key={i}><SolutionNode node={c} depth={depth + 1} /></React.Fragment>)}
        </div>
      )}
    </div>
  );
}

const norm = (s: any): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export default function Report() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [solution, setSolution] = useState<{ plausibleSolution?: string; solutionTree?: any; idealScript?: any[]; exhibits?: any[]; quant?: any; commonWrongTurns?: string[] } | null>(null);
  const [caseBrief, setCaseBrief] = useState<{ title?: string; type?: string; industry?: string; prompt?: string; scenario?: string; keyDataPoints?: Array<{ label?: string; value?: string }> } | null>(null);
  const [fullTranscript, setFullTranscript] = useState<Array<{ role: string; text: string; timestamp?: string }>>([]);
  const [supervisor, setSupervisor] = useState<Array<{ verdict: string; term?: string; at?: string }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openComp, setOpenComp] = useState<number | null>(null);
  const [showCase, setShowCase] = useState(false);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [showAlso, setShowAlso] = useState(false);
  const [idealTranscript, setIdealTranscript] = useState<Array<{ role: string; text: string }> | null>(null);
  const [idealLoading, setIdealLoading] = useState(false);
  const [idealError, setIdealError] = useState('');
  const [showIdeal, setShowIdeal] = useState(false);

  const [regenLoading, setRegenLoading] = useState(false);
  const regenerate = () => {
    if (regenLoading) return;
    setRegenLoading(true);
    api.post(`/reports/${sessionId}/regenerate`)
      .then(() => api.get<{ report: ReportData; solution: typeof solution; caseBrief: typeof caseBrief; transcript: typeof fullTranscript; supervisor?: typeof supervisor }>(`/reports/${sessionId}`))
      .then((data) => { setReport(data.report); setSolution(data.solution ?? null); setCaseBrief(data.caseBrief ?? null); setIdealTranscript(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to regenerate the report.'))
      .finally(() => setRegenLoading(false));
  };

  const loadIdealTranscript = () => {
    setShowIdeal(true);
    if (idealTranscript || idealLoading) return;
    setIdealLoading(true); setIdealError('');
    api.post<{ transcript: Array<{ role: string; text: string }> }>(`/reports/${sessionId}/ideal-transcript`)
      .then((d) => setIdealTranscript(d.transcript ?? []))
      .catch((e) => setIdealError(e instanceof Error ? e.message : 'Failed to generate the ideal transcript.'))
      .finally(() => setIdealLoading(false));
  };

  useEffect(() => {
    if (!sessionId) return;
    api.get<{ report: ReportData; solution: typeof solution; caseBrief: typeof caseBrief; transcript: typeof fullTranscript; supervisor?: typeof supervisor }>(`/reports/${sessionId}`)
      .then((data) => { setReport(data.report); setSolution(data.solution ?? null); setCaseBrief(data.caseBrief ?? null); setFullTranscript(data.transcript ?? []); setSupervisor(data.supervisor ?? null); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load report.'); setLoading(false); });
  }, [sessionId]);

  const downloadTranscript = () => {
    if (!fullTranscript.length) return;
    const start = fullTranscript[0]?.timestamp ? new Date(fullTranscript[0].timestamp).getTime() : 0;
    const stamp = (ts?: string) => {
      if (!ts || !start) return '  -  ';
      const s = Math.max(0, Math.floor((new Date(ts).getTime() - start) / 1000));
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const title = (report as any)?.analysis?.caseTitle || 'Case Interview';
    const header = `THE CASE OWL — Interview Transcript\n${title}\n${'='.repeat(48)}\n\n`;
    const body = fullTranscript.map((t) => `[${stamp(t.timestamp)}] ${t.role === 'candidate' ? 'YOU' : 'INTERVIEWER'}: ${t.text}`).join('\n\n');
    const blob = new Blob([header + body + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `transcript-${sessionId}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  };

  const a = report?.analysis;

  // ── The tape: merge the scattered evidence onto the chronological key turns ──
  const transcriptTurns: any[] = useMemo(() => a?.transcript ?? [], [a]);
  const coachByTs = useMemo(() => {
    const m = new Map<string, any>();
    for (const x of (a?.missedOpportunities ?? [])) if (x?.timestamp) m.set(String(x.timestamp), x);
    return m;
  }, [a]);
  const clarityByTs = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of (a?.communication?.clarityIssues ?? [])) if (c?.timestamp) m.set(String(c.timestamp), c);
    return m;
  }, [a]);
  const signalByTs = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of (a?.integrity?.signals ?? [])) if (s?.timestamp) m.set(String(s.timestamp), s);
    return m;
  }, [a]);
  // Match each model answer to the candidate turn it critiques (by text overlap).
  const { idealByTurn, unmatchedIdeals } = useMemo(() => {
    const byTurn = new Map<number, any>();
    const used = new Set<number>();
    const unmatched: any[] = [];
    for (const q of (a?.idealAnswers ?? [])) {
      const key = norm(q?.candidateAnswer).slice(0, 24);
      let idx = -1;
      if (key) idx = transcriptTurns.findIndex((t, i) => t.role === 'candidate' && !used.has(i) && norm(t.text).includes(key));
      if (idx >= 0) { used.add(idx); byTurn.set(idx, q); } else unmatched.push(q);
    }
    return { idealByTurn: byTurn, unmatchedIdeals: unmatched };
  }, [a, transcriptTurns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-on-tertiary-container mx-auto" />
          <p className="text-secondary font-body">Analysing your interview — this takes a moment…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <p className="text-secondary font-body">{error || 'Report not available.'}</p>
          <Link to="/dashboard" className="text-primary font-bold underline">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  if (!a) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 py-8">
        <h1 className="font-headline text-3xl font-extrabold text-primary">Performance Report</h1>
        <p className="text-secondary leading-relaxed">{report.executiveSummary}</p>
        <div className="no-line-card p-6">
          <p className="text-sm text-on-surface-variant">This report was generated with an earlier version of the analysis engine. Run a new interview for the full evaluator report.</p>
        </div>
        <Link to="/config" className="inline-block px-6 py-3 bg-primary text-on-primary font-bold rounded-lg">Start a new case</Link>
      </div>
    );
  }

  const score10 = Number(a.overall?.score ?? report.overallScore / 10);
  const decision = a.overall?.decision ?? '—';
  const competencies: any[] = a.competencies ?? [];
  const integrity = a.integrity ?? null;
  const suppressed = integrity?.status === 'SUPPRESSED';
  const flagged = integrity?.status === 'FLAGGED';
  const hintsUsed = a.hintDependency?.hintsUsed ?? 0;
  // One-line verdict reason (first sentence of the overall summary).
  const verdictLine = String(a.overall?.summary ?? report.executiveSummary ?? '').split(/(?<=[.!?])\s/)[0];
  const plan: any[] = (a.improvementPlan ?? a.priorityPlan ?? []);
  const badTime = (a.timeManagement ?? []).filter((t: any) => /short|brief|limited|insufficient|long|shallow/i.test(t?.assessment ?? ''));
  const hasAnswerKey = !!(a.candidateSolution || (solution && (solution.plausibleSolution || solution.solutionTree || (Array.isArray(solution.exhibits) && solution.exhibits.length) || (Array.isArray(solution.commonWrongTurns) && solution.commonWrongTurns.length) || (Array.isArray(solution.idealScript) && solution.idealScript.length))));

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-6">
      {/* ── MODULE 1 · THE VERDICT ── */}
      <header className="no-line-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="min-w-0">
          <span className="label-blueprint text-on-tertiary-container font-bold block mb-1">Interview Feedback</span>
          <h1 className="font-headline text-2xl font-extrabold text-primary">{a.caseTitle ?? 'Performance Report'}</h1>
          <p className={cn('mt-2 font-bold', DECISION_COLOR[decision] ?? 'text-primary')}>{decision}{a.difficultyLabel ? ` · ${a.difficultyLabel}` : ''}</p>
          {verdictLine && <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed max-w-xl">{verdictLine}</p>}
          <div className="flex items-center gap-3 mt-3">
            {caseBrief && (caseBrief.prompt || caseBrief.scenario) && (
              <button onClick={() => setShowCase(true)} className="inline-flex items-center gap-1.5 text-sm font-bold text-on-tertiary-container hover:underline">
                <FileText className="w-4 h-4" /> View full case
              </button>
            )}
            {hintsUsed > 0 && <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{hintsUsed} hint{hintsUsed === 1 ? '' : 's'} used</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          {suppressed ? (
            <div className="font-headline text-lg font-bold text-error leading-tight max-w-[12rem]">Scores withheld</div>
          ) : (
            <div className="font-headline text-5xl font-extrabold text-primary leading-none">{score10.toFixed(1)}<span className="text-2xl text-secondary">/10</span></div>
          )}
        </div>
      </header>

      {/* Compact integrity caution (folded from the old banner) */}
      {integrity && (suppressed || flagged) && (
        <div className={cn('rounded-xl border p-3 flex gap-2.5 text-sm', suppressed ? 'border-error/40 bg-error-container/30 text-error' : 'border-amber-300 bg-amber-50 text-amber-800')}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{integrity.banner || (suppressed ? 'Session anomaly detected — scores withheld.' : 'This session showed anomalous patterns; read scores with caution.')}</span>
        </div>
      )}

      {/* ── COMPETENCY BAR · 10-second glance ── */}
      {competencies.length > 0 && (
        <div className="no-line-card p-4">
          <div className="flex flex-wrap gap-2">
            {competencies.map((c, i) => {
              const s = (c.assessed === false || c.score == null) ? null : c.score;
              return (
                <button key={i} onClick={() => setOpenComp(openComp === i ? null : i)}
                  className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition', pillCls(s), openComp === i && 'ring-2 ring-on-tertiary-container/40')}>
                  {c.label}<span className="font-bold">{s == null ? 'N/A' : `${s}`}</span>
                </button>
              );
            })}
          </div>
          {openComp != null && competencies[openComp] && (
            <div className="mt-3 pt-3 border-t border-outline-variant/15 text-sm space-y-2">
              <p className="text-on-surface-variant leading-relaxed">{competencies[openComp].assessment}</p>
              {competencies[openComp].nextAnchor?.text && (
                <p className="text-xs"><span className="font-bold text-secondary">To level up: </span><span className="text-on-surface-variant">{competencies[openComp].nextAnchor.text}</span></p>
              )}
              {(competencies[openComp].evidence ?? []).slice(0, 3).map((e: any, j: number) => (
                <div key={j} className="flex gap-2 text-xs"><span className="font-mono text-on-tertiary-container shrink-0">{e.timestamp}</span><span className="text-secondary">{e.note}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODULE · THE CASE MAP (centerpiece — unchanged) ── */}
      {a.evaluationTree && (
        <Block id="casemap" title="Case Map" action={<span className="label-blueprint">your path vs. the answer key</span>}>
          <div className="space-y-4">
            {a.treeScore && (() => {
              const ts = a.treeScore;
              const pct = ts.global?.percentage ?? ts.percentage ?? 0;
              const score = ts.global?.score ?? ts.total ?? 0;
              const max = ts.global?.max ?? ts.max ?? 0;
              const reached = ts.terminals_reached, total = ts.terminals_total, strong = ts.strong_branches;
              return (
                <div className="no-line-card p-5 flex items-center gap-5">
                  <div className="text-center shrink-0">
                    <div className="font-headline text-3xl font-extrabold text-primary leading-none">{pct}%</div>
                    <div className="label-blueprint mt-1">{score}/{max} pts</div>
                  </div>
                  <div className="flex-grow">
                    <div className="font-bold text-primary">{ts.grade}</div>
                    {reached != null ? (
                      <p className="text-xs text-secondary mt-0.5">
                        Global {pct}% · reached {reached}/{total} terminal{total === 1 ? '' : 's'} · {strong} strong branch{strong === 1 ? '' : 'es'}. Global measures coverage; per-branch local scores measure depth of thinking. Open the map for the breakdown.
                      </p>
                    ) : (
                      <p className="text-xs text-secondary mt-0.5">Deterministic traversal score. Open the map for the full breakdown.</p>
                    )}
                  </div>
                </div>
              );
            })()}
            {a.treeSummary && (
              <div className="no-line-card p-5">
                {a.treeSummary.overall_rating && (
                  <p className="text-sm font-bold text-primary mb-3">{a.treeSummary.overall_rating}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                  {([
                    ['Nodes explored', `${a.treeSummary.nodes_explored ?? '—'} / ${a.treeSummary.total_nodes_in_reference ?? '—'}`],
                    ['Max depth (correct)', a.treeSummary.max_depth_on_correct_path],
                    ['Wrong turns', a.treeSummary.wrong_turns_taken],
                    ['Dead ends', a.treeSummary.dead_ends_hit],
                    ['Traps avoided', a.treeSummary.nodes_skipped_wrong],
                    ['Nudges given', a.treeSummary.nudges_given],
                    ['Time on correct path', a.treeSummary.time_on_correct_path],
                    ['Time on wrong paths', a.treeSummary.time_on_wrong_paths],
                    ['Exhibits asked unprompted', a.treeSummary.exhibits_requested_unprompted],
                  ] as [string, any][]).filter(([, v]) => v !== undefined && v !== null).map(([label, v]) => (
                    <div key={label} className="flex justify-between gap-2 border-b border-outline-variant/15 py-1">
                      <span className="text-secondary">{label}</span>
                      <span className="font-bold text-primary text-right">{String(v)}</span>
                    </div>
                  ))}
                </div>
                {Array.isArray(a.treeSummary.key_insight_missed) && a.treeSummary.key_insight_missed.length > 0 && (
                  <p className="text-xs text-error mt-3"><span className="font-bold">Missed: </span>{a.treeSummary.key_insight_missed.join('; ')}</p>
                )}
              </div>
            )}
            <React.Suspense fallback={<div className="no-line-card p-8 text-center text-sm text-secondary">Loading case map…</div>}>
              <CaseTree root={a.evaluationTree} summary={a.treeSummary} score={a.treeScore} />
            </React.Suspense>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-secondary">Opens full-screen: click any node to see the right move there and how you did; double-click to collapse a branch; use the minimap and zoom slider to navigate.</p>
              <button onClick={loadIdealTranscript} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container transition">
                <FileText className="w-4 h-4" /> Ideal Transcript
              </button>
            </div>
          </div>
        </Block>
      )}

      {/* ── MODULE 2 · THE TAPE ── */}
      {transcriptTurns.length > 0 && (
        <Block id="tape" title="The tape" action={<span className="label-blueprint">your interview, moment by moment</span>}>
          {badTime.length > 0 && (
            <p className="text-xs text-secondary mb-4">Pacing: {badTime.map((t: any) => `${t.stage} — ${String(t.assessment).toLowerCase()}`).join(' · ')}</p>
          )}
          <div className="space-y-5">
            {transcriptTurns.map((t, i) => {
              const coach = coachByTs.get(String(t.timestamp));
              const clarity = clarityByTs.get(String(t.timestamp));
              const sig = signalByTs.get(String(t.timestamp));
              const ideal = idealByTurn.get(i);
              const mom = t.momentum as string | undefined;
              const momBorder = mom === 'GREEN' ? 'border-green-500' : mom === 'RED' ? 'border-error' : mom === 'YELLOW' ? 'border-amber-400' : 'border-outline-variant/25';
              return (
                <div key={i} className={cn('pl-4 border-l-2', momBorder)}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold text-on-tertiary-container font-mono">[{t.timestamp}] {t.role === 'candidate' ? 'YOU' : 'INTERVIEWER'}</span>
                    {t.role === 'interviewer' && t.intent && <span className="text-[10px] font-medium text-on-tertiary-container bg-tertiary-fixed/40 px-1.5 py-0.5 rounded">Testing: {t.intent}</span>}
                    {(t.tags ?? []).map((tag: string, j: number) => <span key={j} className="text-[10px] text-secondary bg-surface-container-low px-1.5 py-0.5 rounded">#{tag}</span>)}
                  </div>
                  <p className={cn('text-sm leading-relaxed', t.role === 'candidate' ? 'text-primary font-medium' : 'text-on-surface-variant')}>“{t.text}”</p>

                  {/* Layer: markers (strength / issue) */}
                  {(t.markers ?? []).map((m: any, j: number) => (
                    <div key={j} className={cn('flex gap-1.5 text-xs mt-1.5', m.type === 'strength' ? 'text-green-700' : 'text-amber-700')}>
                      {m.type === 'strength' ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}<span>{m.note}</span>
                    </div>
                  ))}

                  {/* Layer: integrity flag at this moment */}
                  {sig && <p className="text-xs text-error mt-1.5 font-medium">⚠ {sig.detail}</p>}

                  {/* Layer: clarity rewrite */}
                  {clarity && (
                    <p className="text-xs mt-1.5"><span className="font-bold text-error">Vague:</span> {clarity.issue} <span className="text-green-700">→ “{clarity.better}”</span></p>
                  )}

                  {/* Layer: coach's note (the gap + the drill, in 2nd person) */}
                  {coach && (
                    <div className="mt-2 bg-amber-50/70 border-l-2 border-amber-400 rounded-r-lg px-3 py-2 text-xs space-y-1">
                      <div className="font-bold text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Coach</div>
                      {(coach.gap || coach.missed) && <p className="text-on-surface-variant"><span className="font-bold text-error">The gap: </span>{coach.gap || coach.missed}</p>}
                      {(coach.practicePattern || coach.better) && <p className="text-on-surface-variant"><span className="font-bold text-green-700">Try: </span>{coach.practicePattern || coach.better}</p>}
                    </div>
                  )}

                  {/* Layer: what good sounds like (model answer, anchored here) */}
                  {ideal && (
                    <div className="mt-2 grid sm:grid-cols-2 gap-2">
                      <div className="bg-surface-container-low rounded-lg p-2.5">
                        <div className="label-blueprint mb-1">Your answer</div>
                        <p className="text-xs text-on-surface-variant leading-relaxed">{ideal.candidateAnswer}</p>
                      </div>
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                        <div className="label-blueprint text-green-700 mb-1 flex items-center justify-between">
                          What good sounds like {ideal.similarityScore != null && <span className="font-mono text-secondary">sim {ideal.similarityScore}</span>}
                        </div>
                        <p className="text-xs text-on-surface-variant leading-relaxed">{ideal.modelAnswer || ideal.strongerAnswer}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Model answers that didn't map to a specific turn */}
          {unmatchedIdeals.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="label-blueprint text-secondary">Other key exchanges</p>
              {unmatchedIdeals.map((q: any, i: number) => (
                <div key={i} className="no-line-card p-4 space-y-2">
                  <p className="text-sm font-bold text-primary">{q.question}</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="bg-surface-container-low rounded-lg p-2.5"><div className="label-blueprint mb-1">Your answer</div><p className="text-xs text-on-surface-variant">{q.candidateAnswer}</p></div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-2.5"><div className="label-blueprint text-green-700 mb-1">What good sounds like</div><p className="text-xs text-on-surface-variant">{q.modelAnswer || q.strongerAnswer}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Block>
      )}

      {/* ── MODULE 3 · YOUR ONE THING ── */}
      {plan.length > 0 && (
        <Block id="onething" title="Your one thing" action={<span className="label-blueprint">the highest-leverage fix</span>}>
          <div className="no-line-card p-5 border-l-4 border-on-tertiary-container space-y-2">
            <p className="text-base font-bold text-primary">{plan[0].action}</p>
            {(plan[0].evidenceExcerpt || plan[0].detail) && (
              <p className="text-sm text-on-surface-variant leading-relaxed"><span className="font-bold text-on-tertiary-container">Why: </span>{plan[0].evidenceExcerpt || plan[0].detail}</p>
            )}
            {(plan[0].practiceDrill || plan[0].practiceMethod) && (
              <p className="text-sm text-on-surface-variant leading-relaxed"><span className="font-bold text-on-tertiary-container">Drill: </span>{plan[0].practiceDrill || plan[0].practiceMethod}</p>
            )}
            {plan[0].completionCriteria && (
              <p className="text-sm text-on-surface-variant leading-relaxed"><span className="font-bold text-green-700">Done when: </span>{plan[0].completionCriteria}</p>
            )}
          </div>
          {plan[1] && (
            <div className="mt-3">
              <button onClick={() => setShowAlso((s) => !s)} className="flex items-center gap-1.5 text-sm font-semibold text-secondary hover:text-primary">
                <ChevronDown className={cn('w-4 h-4 transition-transform', showAlso && 'rotate-180')} /> Also consider
              </button>
              {showAlso && (
                <div className="no-line-card p-5 mt-2 space-y-2">
                  <p className="text-sm font-bold text-primary">{plan[1].action}</p>
                  {(plan[1].practiceDrill || plan[1].practiceMethod) && <p className="text-sm text-on-surface-variant"><span className="font-bold text-on-tertiary-container">Drill: </span>{plan[1].practiceDrill || plan[1].practiceMethod}</p>}
                  {plan[1].completionCriteria && <p className="text-sm text-on-surface-variant"><span className="font-bold text-green-700">Done when: </span>{plan[1].completionCriteria}</p>}
                </div>
              )}
            </div>
          )}
        </Block>
      )}

      {/* ── MODULE 5 · THE ANSWER KEY (expandable) ── */}
      {hasAnswerKey && (
        <div className="no-line-card overflow-hidden">
          <button onClick={() => setShowAnswerKey((s) => !s)} className="w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-surface-container-low transition">
            <div>
              <h3 className="font-headline text-lg font-bold text-primary">The answer key</h3>
              <p className="text-xs text-secondary">Model solution, exhibits & common wrong turns — study the case itself.</p>
            </div>
            <ChevronDown className={cn('w-5 h-5 text-secondary transition-transform shrink-0', showAnswerKey && 'rotate-180')} />
          </button>
          {showAnswerKey && (
            <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/10 pt-4">
              {a.candidateSolution && (
                <div className="border-l-4 border-amber-400 pl-4">
                  <p className="label-blueprint text-amber-700 font-bold mb-1">Your solution</p>
                  <p className="text-sm text-primary leading-relaxed whitespace-pre-line">{a.candidateSolution}</p>
                </div>
              )}
              {solution?.plausibleSolution && (
                <div className="border-l-4 border-on-tertiary-container pl-4">
                  <p className="label-blueprint text-on-tertiary-container font-bold mb-1">The model recommendation</p>
                  <p className="text-sm text-primary leading-relaxed">{solution.plausibleSolution}</p>
                </div>
              )}
              {solution?.quant && (solution.quant.task || solution.quant.derivation) && (
                <div className="bg-surface-container-low rounded-lg p-3 space-y-1">
                  <p className="label-blueprint text-on-tertiary-container font-bold">The quant</p>
                  {solution.quant.task && <p className="text-sm font-bold text-primary">{solution.quant.task}</p>}
                  {solution.quant.derivation && <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{solution.quant.derivation}</p>}
                  {solution.quant.answer && <p className="text-sm text-green-700"><span className="font-bold">Answer: </span>{solution.quant.answer}</p>}
                </div>
              )}
              {solution && Array.isArray(solution.exhibits) && solution.exhibits.length > 0 && (
                <div>
                  <p className="label-blueprint mb-2">Exhibits</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {solution.exhibits.map((e: any, i: number) => (
                      <div key={i}>
                        <ExhibitCard ex={e} large />
                        {e.insight && <p className="text-xs text-on-tertiary-container mt-1.5"><span className="font-bold">Reveals: </span>{e.insight}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(solution?.commonWrongTurns) && solution!.commonWrongTurns!.length > 0 && (
                <div>
                  <p className="label-blueprint text-error font-bold mb-2">Common wrong turns</p>
                  <ul className="space-y-1.5 text-sm text-on-surface-variant">
                    {solution!.commonWrongTurns!.map((w: string, i: number) => (
                      <li key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {solution?.solutionTree && (
                <div>
                  <p className="label-blueprint text-secondary font-bold mb-2">How a strong candidate gets there</p>
                  <SolutionNode node={solution.solutionTree} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Admin-only: silent-supervisor compliance flags */}
      {supervisor && (
        <div className="rounded-xl border border-dashed border-outline-variant/40 p-5 bg-surface-container-lowest">
          <p className="label-blueprint text-secondary font-bold mb-2">Interviewer compliance (admin · debug)</p>
          {supervisor.length === 0 ? (
            <p className="text-sm text-green-700">No leading or fed-data flags this session. ✓</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-bold text-amber-700">{supervisor.length} flag{supervisor.length > 1 ? 's' : ''}:</p>
              {supervisor.map((f, i) => (
                <div key={i} className="text-xs text-on-surface-variant flex gap-2">
                  <span className={cn('font-mono font-bold', f.verdict === 'FED_DATA' ? 'text-error' : 'text-amber-600')}>{f.verdict}</span>
                  <span>named “{f.term}” before the candidate did</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-surface-container rounded-xl">
        <div className="flex gap-3 w-full sm:w-auto">
          <button onClick={() => window.print()} className="flex-1 sm:flex-none flex items-center gap-2 px-5 py-3 bg-white text-primary border border-outline-variant/20 font-bold rounded-lg hover:bg-surface-container-low transition justify-center">
            <Download className="w-4 h-4" /> Download Report
          </button>
          <button onClick={downloadTranscript} disabled={!fullTranscript.length} className="flex-1 sm:flex-none flex items-center gap-2 px-5 py-3 bg-white text-primary border border-outline-variant/20 font-bold rounded-lg hover:bg-surface-container-low transition justify-center disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" /> Full Transcript
          </button>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button onClick={regenerate} disabled={regenLoading} className="flex-1 sm:flex-none flex items-center gap-2 px-5 py-3 border border-outline-variant/20 text-primary font-bold rounded-lg hover:bg-surface-container-low transition justify-center disabled:opacity-50 disabled:cursor-not-allowed">
            {regenLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {regenLoading ? 'Regenerating…' : 'Regenerate report'}
          </button>
          <Link to="/config" className="flex-1 sm:flex-none flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-bold rounded-lg hover:bg-primary-container transition justify-center">
            Practise Similar Case <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Full-case modal */}
      {showCase && caseBrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setShowCase(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 p-6 border-b border-outline-variant/15 shrink-0">
              <div>
                <span className="label-blueprint text-on-tertiary-container font-bold block mb-1">The Full Case</span>
                <h2 className="font-headline text-xl font-extrabold text-primary">{caseBrief.title ?? a.caseTitle ?? 'Case'}</h2>
                {(caseBrief.type || caseBrief.industry) && (
                  <p className="text-xs text-secondary capitalize mt-0.5">{[caseBrief.type, caseBrief.industry].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <button onClick={() => setShowCase(false)} className="text-secondary hover:text-primary transition shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto scrolling-log p-6 space-y-5">
              {caseBrief.prompt && (
                <div className="border-l-4 border-on-tertiary-container pl-4">
                  <div className="label-blueprint text-on-tertiary-container font-bold mb-1">The prompt</div>
                  <p className="text-base text-primary font-medium leading-relaxed">{caseBrief.prompt}</p>
                </div>
              )}
              {caseBrief.scenario && caseBrief.scenario !== caseBrief.prompt && (
                <div>
                  <div className="label-blueprint mb-1">Background</div>
                  <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{caseBrief.scenario}</p>
                </div>
              )}
              {Array.isArray(caseBrief.keyDataPoints) && caseBrief.keyDataPoints.length > 0 && (
                <div>
                  <div className="label-blueprint mb-2">Key data</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {caseBrief.keyDataPoints.map((d, i) => (
                      <div key={i} className="flex justify-between gap-3 bg-surface-container-low rounded-lg px-3 py-2 text-sm">
                        <span className="text-secondary">{d.label}</span>
                        <span className="font-bold text-primary text-right">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {solution && Array.isArray(solution.exhibits) && solution.exhibits.length > 0 && (
                <div>
                  <div className="label-blueprint mb-2">Exhibits</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {solution.exhibits.map((e: any, i: number) => (
                      <div key={i}><ExhibitCard ex={e} large /></div>
                    ))}
                  </div>
                </div>
              )}
              {solution?.quant && (solution.quant.task || solution.quant.derivation) && (
                <div>
                  <div className="label-blueprint mb-2">The quant</div>
                  <div className="bg-surface-container-low rounded-lg p-3 space-y-1">
                    {solution.quant.task && <p className="text-sm font-bold text-primary">{solution.quant.task}</p>}
                    {solution.quant.derivation && <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{solution.quant.derivation}</p>}
                    {solution.quant.answer && <p className="text-sm text-green-700"><span className="font-bold">Answer: </span>{solution.quant.answer}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ideal transcript modal */}
      {showIdeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setShowIdeal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 p-6 border-b border-outline-variant/15 shrink-0">
              <div>
                <span className="label-blueprint text-on-tertiary-container font-bold block mb-1">Ideal Transcript</span>
                <h2 className="font-headline text-xl font-extrabold text-primary">How a top candidate works this case</h2>
                <p className="text-xs text-secondary mt-0.5">A model interview following the highest-scoring path through the answer key.</p>
              </div>
              <button onClick={() => setShowIdeal(false)} className="text-secondary hover:text-primary transition shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto scrolling-log p-6 space-y-4">
              {idealLoading && (
                <div className="flex items-center justify-center py-16 gap-3 text-secondary">
                  <Loader2 className="w-6 h-6 animate-spin" /> <span className="text-sm">Writing the model transcript — this takes a moment…</span>
                </div>
              )}
              {idealError && !idealLoading && <p className="text-sm text-error">{idealError}</p>}
              {!idealLoading && !idealError && idealTranscript && idealTranscript.length === 0 && (
                <p className="text-sm text-secondary">No ideal transcript available for this case.</p>
              )}
              {!idealLoading && idealTranscript && idealTranscript.map((t, i) => (
                <div key={i} className={cn('flex flex-col', t.role === 'candidate' ? 'items-end' : 'items-start')}>
                  <span className="text-[10px] font-bold font-mono mb-1 text-on-tertiary-container">{t.role === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER'}</span>
                  <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    t.role === 'candidate' ? 'bg-primary text-on-primary rounded-tr-sm' : 'bg-surface-container-low text-on-surface-variant rounded-tl-sm')}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
