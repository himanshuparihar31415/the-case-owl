import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle, AlertCircle, AlertTriangle, Loader2, ArrowRight, Download,
  RefreshCw, Bookmark, ChevronDown, FileText, X,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/src/lib/api';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

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

const READINESS_COLOR: Record<string, string> = {
  'Not ready': 'bg-error-container text-on-error-container',
  'Needs practice': 'bg-amber-100 text-amber-800',
  'Interview ready': 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  'Strong candidate': 'bg-green-100 text-green-800',
};

const DECISION_COLOR: Record<string, string> = {
  'No Hire': 'text-error',
  Borderline: 'text-amber-600',
  Hire: 'text-on-tertiary-container',
  'Strong Hire': 'text-green-600',
};

function scoreColor(s: number): string {
  if (s < 4) return 'bg-error';
  if (s < 6) return 'bg-amber-500';
  if (s < 8) return 'bg-on-tertiary-container';
  return 'bg-green-600';
}

// A report section. Belongs to a `tab`; on screen only the active tab's sections
// render, but ALL render in print (so Download/Print assembles the full report).
function Section({ id, title, children, action, tab, activeTab }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode; tab?: string; activeTab?: string }) {
  const hidden = !!(tab && activeTab && tab !== activeTab);
  return (
    <section id={id} className={cn('scroll-mt-28', hidden && 'hidden print:block')}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-headline text-xl font-bold text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Vertical-nav tabs. Each groups one or more sections; nothing is dropped — the
// solution tree keeps its own prominent tab. [id, label].
const TABS = [
  ['overview', 'Overview'],
  ['casemap', 'Case Map'],
  ['competencies', 'Competencies'],
  ['communication', 'Communication'],
  ['coaching', 'Time & Coaching'],
  ['solution', 'Model Solution'],
  ['ideal', 'Ideal Answers'],
  ['exhibits', 'Exhibits'],
  ['progress', 'Progress'],
] as const;

// Recursive node for the comprehensive solution tree. Indented with connector
// lines; each node carries a label and an optional insight/finding.
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

const TRANSCRIPT_FILTERS = ['All', 'Strengths', 'Critical Issues', 'Grammar', 'Quantitative', 'Missed Opportunities', 'Hint Usage'] as const;
type Filter = typeof TRANSCRIPT_FILTERS[number];

export default function Report() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [solution, setSolution] = useState<{ plausibleSolution?: string; solutionTree?: any; idealScript?: any[]; exhibits?: any[]; quant?: any; commonWrongTurns?: string[] } | null>(null);
  const [caseBrief, setCaseBrief] = useState<{ title?: string; type?: string; industry?: string; prompt?: string; scenario?: string; keyDataPoints?: Array<{ label?: string; value?: string }> } | null>(null);
  const [fullTranscript, setFullTranscript] = useState<Array<{ role: string; text: string; timestamp?: string }>>([]);
  const [supervisor, setSupervisor] = useState<Array<{ verdict: string; term?: string; at?: string }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedComp, setExpandedComp] = useState<Set<number>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('All');
  const [openCoach, setOpenCoach] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [showCase, setShowCase] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    api.get<{ report: ReportData; solution: typeof solution; caseBrief: typeof caseBrief; transcript: typeof fullTranscript; supervisor?: typeof supervisor }>(`/reports/${sessionId}`)
      .then((data) => { setReport(data.report); setSolution(data.solution ?? null); setCaseBrief(data.caseBrief ?? null); setFullTranscript(data.transcript ?? []); setSupervisor(data.supervisor ?? null); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load report.'); setLoading(false); });
  }, [sessionId]);

  // Build a plain-text transcript and download it. mm:ss is relative to the
  // first turn so timestamps line up with the report's evidence.
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
    const body = fullTranscript
      .map((t) => `[${stamp(t.timestamp)}] ${t.role === 'candidate' ? 'YOU' : 'INTERVIEWER'}: ${t.text}`)
      .join('\n\n');
    const blob = new Blob([header + body + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript-${sessionId}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const a = report?.analysis;

  const transcriptTurns: any[] = useMemo(() => a?.transcript ?? [], [a]);
  // Link transcript moments to their four-part coaching (spec §10): map each
  // missed opportunity to its timestamp so a tagged turn can expand into Setup /
  // Your Move / The Gap / Practice Pattern.
  const coachByTs = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of (a?.missedOpportunities ?? [])) if (m?.timestamp) map.set(String(m.timestamp), m);
    return map;
  }, [a]);
  const filteredTurns = useMemo(() => {
    if (filter === 'All') return transcriptTurns;
    return transcriptTurns.filter((t) => {
      const tags: string[] = t.tags ?? [];
      const markers: any[] = t.markers ?? [];
      switch (filter) {
        case 'Strengths': return markers.some((m) => m.type === 'strength');
        case 'Critical Issues': return markers.some((m) => m.type === 'issue');
        case 'Grammar': return tags.includes('Grammar');
        case 'Quantitative': return tags.includes('Quantitative');
        case 'Missed Opportunities': return tags.includes('MissedOpportunity');
        case 'Hint Usage': return t.role === 'interviewer' && /hint/i.test(t.text ?? '');
        default: return true;
      }
    });
  }, [transcriptTurns, filter]);

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

  // Fallback for legacy reports without the rich analysis
  if (!a) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 py-8">
        <h1 className="font-headline text-3xl font-extrabold text-primary">Performance Report</h1>
        <p className="text-secondary leading-relaxed">{report.executiveSummary}</p>
        <div className="no-line-card p-6">
          <p className="text-sm text-on-surface-variant">
            This report was generated with an earlier version of the analysis engine, so the detailed
            evidence view isn&apos;t available. Run a new interview to get the full evaluator report.
          </p>
        </div>
        <Link to="/config" className="inline-block px-6 py-3 bg-primary text-on-primary font-bold rounded-lg">Start a new case</Link>
      </div>
    );
  }

  const score10 = Number(a.overall?.score ?? report.overallScore / 10);
  const decision = a.overall?.decision ?? '—';
  const readiness = a.overall?.readiness ?? '—';
  const competencies: any[] = a.competencies ?? [];
  const metrics = a.communication?.fluency?.metrics ?? report.metrics ?? {};
  const progress: any[] = report.progress ?? [];

  // Session integrity (spec §1): suppress scores on a CRITICAL signal, caution-banner
  // + LOW confidence when FLAGGED.
  const integrity = a.integrity ?? null;
  const suppressed = integrity?.status === 'SUPPRESSED';
  const flagged = integrity?.status === 'FLAGGED';
  const confidence = suppressed || flagged ? 'Low' : (a.overall?.confidence ?? '—');

  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  };

  return (
    <div className="space-y-8 py-6">
      {/* Header */}
      <header className="no-line-card p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <span className="label-blueprint text-on-tertiary-container font-bold block mb-1">Interview Feedback</span>
          <h1 className="font-headline text-2xl font-extrabold text-primary">{a.caseTitle ?? 'Performance Report'}</h1>
          <p className={cn('mt-2 font-bold text-sm', DECISION_COLOR[decision] ?? 'text-primary')}>
            {decision} · {a.difficultyLabel ?? ''}
          </p>
          {caseBrief && (caseBrief.prompt || caseBrief.scenario) && (
            <button onClick={() => setShowCase(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-on-tertiary-container hover:underline">
              <FileText className="w-4 h-4" /> View full case
            </button>
          )}
        </div>
        <div className="flex items-center gap-5">
          {!suppressed && (
            <div className={cn('px-3 py-1.5 rounded-full text-sm font-bold', READINESS_COLOR[readiness] ?? 'bg-surface-container text-primary')}>
              {readiness}
            </div>
          )}
          <div className="text-right">
            {suppressed ? (
              <div className="font-headline text-lg font-bold text-error leading-tight max-w-[12rem]">Scores withheld</div>
            ) : (
              <div className="font-headline text-4xl font-extrabold text-primary leading-none">
                {score10.toFixed(1)}<span className="text-xl text-secondary">/10</span>
              </div>
            )}
            <div className="label-blueprint mt-1">Confidence: {confidence}</div>
          </div>
        </div>
      </header>

      {/* Session integrity banner (spec §1) */}
      {integrity && (suppressed || flagged) && (
        <div className={cn('rounded-xl border p-4 flex gap-3',
          suppressed ? 'border-error/40 bg-error-container/30' : 'border-amber-300 bg-amber-50')}>
          <AlertTriangle className={cn('w-5 h-5 shrink-0 mt-0.5', suppressed ? 'text-error' : 'text-amber-600')} />
          <div className="space-y-2">
            <p className={cn('text-sm font-bold', suppressed ? 'text-error' : 'text-amber-800')}>
              {suppressed ? 'Session anomaly detected — scores withheld' : 'This session showed anomalous patterns'}
            </p>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {integrity.banner || 'Scores below should be interpreted with caution and may not reflect true ability.'}
            </p>
            {Array.isArray(integrity.signals) && integrity.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {integrity.signals.map((s: any, i: number) => (
                  <span key={i} className={cn('text-[10px] font-bold px-2 py-0.5 rounded font-mono',
                    s.severity === 'CRITICAL' ? 'bg-error-container text-on-error-container'
                      : s.severity === 'HIGH' ? 'bg-amber-100 text-amber-800' : 'bg-surface-container text-secondary')}>
                    {String(s.signal ?? '').replace(/_/g, ' ')} · {s.severity}
                  </span>
                ))}
              </div>
            )}
            {integrity.dualTrack && (
              <p className="text-xs text-on-surface-variant italic border-t border-outline-variant/20 pt-2">{integrity.dualTrack}</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[180px_minmax(0,1fr)_340px] gap-8">
        {/* LEFT: vertical section nav (tabs). One section group at a time on screen;
            print renders everything. */}
        <nav className="xl:sticky xl:top-32 self-start flex xl:flex-col gap-1 overflow-x-auto scrolling-log print:hidden -mx-1 px-1">
          {TABS.filter(([id]) => {
            if (id === 'solution') return !!(a.candidateSolution || (solution && (solution.plausibleSolution || solution.solutionTree)));
            if (id === 'ideal') return !!((a.idealAnswers && a.idealAnswers.length) || (solution && Array.isArray(solution.idealScript) && solution.idealScript.length > 0));
            if (id === 'exhibits') return !!(solution && Array.isArray(solution.exhibits) && solution.exhibits.length > 0);
            if (id === 'casemap') return !!a.evaluationTree;
            return true;
          }).map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} className={cn('shrink-0 text-left px-3 py-2 rounded-md text-sm font-medium transition',
              activeTab === id ? 'bg-primary text-on-primary' : 'text-secondary hover:text-primary hover:bg-surface-container-low')}>
              {label}
            </button>
          ))}
        </nav>

        {/* CENTER: report sections (only the active tab's render on screen) */}
        <div className="min-w-0 space-y-10">
          {/* The Case — what the candidate was asked, formatted */}
          {caseBrief && (caseBrief.prompt || caseBrief.scenario) && (
            <Section id="thecase" title="The Case" tab="overview" activeTab={activeTab}
              action={(caseBrief.type || caseBrief.industry) ? <span className="label-blueprint capitalize">{[caseBrief.type, caseBrief.industry].filter(Boolean).join(' · ')}</span> : undefined}>
              <div className="no-line-card p-6 space-y-4">
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
              </div>
            </Section>
          )}

          {/* Overall */}
          <Section id="overall" title="Overall Assessment" tab="overview" activeTab={activeTab}>
            <div className="no-line-card p-6 space-y-5">
              <p className="text-on-surface-variant leading-relaxed">{a.overall?.summary}</p>
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <div className="label-blueprint mb-2 text-green-700">Primary Strengths</div>
                  <ul className="space-y-1.5 text-sm text-on-surface-variant">
                    {(a.overall?.primaryStrengths ?? []).map((s: string, i: number) => (
                      <li key={i} className="flex gap-2"><CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label-blueprint mb-2 text-error">Critical Gaps</div>
                  <ul className="space-y-1.5 text-sm text-on-surface-variant">
                    {(a.overall?.criticalGaps ?? []).map((s: string, i: number) => (
                      <li key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {a.overall?.hintDependencyNote && (
                <p className="text-xs text-secondary italic border-t border-outline-variant/15 pt-3">{a.overall.hintDependencyNote}</p>
              )}
            </div>
          </Section>

          {/* Competency Matrix */}
          <Section id="competencies" title="Core Competency Matrix" tab="competencies" activeTab={activeTab} action={<span className="label-blueprint">click a row for evidence</span>}>
            <div className="space-y-3">
              {competencies.map((c, i) => {
                const open = expandedComp.has(i);
                const notAssessed = c.assessed === false || c.score == null;
                return (
                  <div key={i} className="no-line-card overflow-hidden">
                    <button onClick={() => setExpandedComp((s) => toggle(s, i))} className="w-full p-4 flex items-center gap-4 text-left hover:bg-surface-container-low transition">
                      <ChevronDown className={cn('w-4 h-4 text-secondary transition-transform shrink-0', open && 'rotate-180')} />
                      <span className="font-bold text-sm text-primary w-48 shrink-0">{c.label}</span>
                      {notAssessed ? (
                        <span className="flex-grow text-xs text-secondary italic">Not assessed — insufficient evidence</span>
                      ) : suppressed ? (
                        <span className="flex-grow text-xs text-error italic">withheld (session anomaly)</span>
                      ) : (
                        <div className="flex-grow h-2 bg-surface-container-highest rounded-full overflow-hidden">
                          <div className={cn('h-full', scoreColor(c.score))} style={{ width: `${(c.score ?? 0) * 10}%` }} />
                        </div>
                      )}
                      <span className="font-headline font-bold text-primary w-14 text-right shrink-0">
                        {notAssessed ? 'N/A' : suppressed ? '—' : `${c.score}/10`}
                      </span>
                    </button>
                    {open && (
                      <div className="px-5 pb-5 pl-12 space-y-3">
                        <p className="text-sm text-on-surface-variant leading-relaxed">{c.assessment}</p>
                        {/* Anchor ladder: where you are vs the next level (spec §2) */}
                        {!notAssessed && (c.currentAnchor || c.nextAnchor) && (
                          <div className="space-y-1.5 bg-surface-container-low rounded-lg p-3">
                            {c.currentAnchor && (
                              <p className="text-xs leading-relaxed">
                                <span className="font-bold text-amber-700">YOU ARE HERE{c.currentAnchor.level != null ? ` (${c.currentAnchor.level})` : ''}: </span>
                                <span className="text-on-surface-variant">{c.currentAnchor.text}</span>
                              </p>
                            )}
                            {c.nextAnchor && (
                              <p className="text-xs leading-relaxed">
                                <span className="font-bold text-secondary">NEXT LEVEL{c.nextAnchor.level != null ? ` (${c.nextAnchor.level})` : ''}: </span>
                                <span className="text-secondary">{c.nextAnchor.text}</span>
                              </p>
                            )}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          {(c.evidence ?? []).map((e: any, j: number) => (
                            <div key={j} className="flex gap-2 text-xs">
                              <span className="font-mono text-on-tertiary-container shrink-0">{e.timestamp}</span>
                              <span className="text-secondary">{e.note}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Communication */}
          <Section id="communication" title="Communication Quality" tab="communication" activeTab={activeTab}>
            <div className="space-y-6">
              {/* Communication Effectiveness (replaces Grammar — spec §4) */}
              {a.communication?.effectiveness ? (
                <div className="no-line-card p-6">
                  <h4 className="font-bold text-primary mb-1">Communication Effectiveness</h4>
                  <p className="text-[11px] text-secondary mb-4">What real interviewers track — leading with your answer, signposting the plan, and how cleanly you recover under pressure.</p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-surface-container-low rounded-lg p-3">
                      <div className="font-headline font-bold text-lg text-primary">{a.communication.effectiveness.answerStructureRate ?? '—'}%</div>
                      <div className="label-blueprint">Led with the answer</div>
                    </div>
                    <div className="bg-surface-container-low rounded-lg p-3">
                      <div className="font-headline font-bold text-lg text-primary">{a.communication.effectiveness.signpostingRate ?? '—'}%</div>
                      <div className="label-blueprint">Signposted the plan</div>
                    </div>
                  </div>
                  {a.communication.effectiveness.summary && <p className="text-sm text-on-surface-variant mb-4">{a.communication.effectiveness.summary}</p>}
                  {(a.communication.effectiveness.recoveryInstances ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="label-blueprint">Recovery under pressure</div>
                      {a.communication.effectiveness.recoveryInstances.map((r: any, i: number) => (
                        <div key={i} className="text-xs flex gap-2">
                          <span className="font-mono text-on-tertiary-container shrink-0">{r.timestamp}</span>
                          <span className={cn('font-bold shrink-0 uppercase', r.type === 'clean' ? 'text-green-700' : r.type === 'freeze' ? 'text-error' : 'text-amber-600')}>{r.type}</span>
                          <span className="text-secondary">{r.situation}{r.note ? ` — ${r.note}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(a.communication.clarityIssues ?? []).length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-outline-variant/15 pt-3">
                      <div className="label-blueprint text-error">Clarity issues (would confuse an interviewer)</div>
                      {a.communication.clarityIssues.map((g: any, i: number) => (
                        <div key={i} className="text-xs border-l-2 border-error/40 pl-3">
                          <div className="text-secondary">“{g.statement}” <span className="font-mono text-on-tertiary-container">{g.timestamp}</span></div>
                          <div className="text-error mt-0.5">{g.issue}</div>
                          <div className="text-on-surface-variant mt-0.5">→ “{g.better}”</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : a.communication?.grammar ? (
                /* legacy report shape */
                <div className="no-line-card p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-primary">Grammar &amp; Correctness</h4>
                    <span className="font-headline font-bold text-primary">{a.communication.grammar.score}/10</span>
                  </div>
                  <p className="text-sm text-on-surface-variant mb-4">{a.communication.grammar.summary}</p>
                  <div className="space-y-3">
                    {(a.communication.grammar.issues ?? []).map((g: any, i: number) => (
                      <div key={i} className="text-xs border-l-2 border-error/40 pl-3">
                        <div className="font-mono text-on-tertiary-container">{g.timestamp} · <span className="text-error not-italic font-bold">{g.issue}</span></div>
                        <div className="text-secondary line-through mt-0.5">“{g.statement}”</div>
                        <div className="text-on-surface-variant mt-0.5">→ “{g.better}”</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Fluency v2 */}
              <div className="no-line-card p-6">
                <h4 className="font-bold text-primary mb-1">Fluency</h4>
                <p className="text-[11px] text-secondary mb-4">Did your responses actually advance the case? Measured from the transcript &amp; timing.</p>
                {/* v2 diagnostic rates lead */}
                {(a.communication?.fluency?.coherenceRate != null || a.communication?.fluency?.firstResponseRate != null) && (
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-surface-container-low rounded-lg p-3">
                      <div className="font-headline font-bold text-lg text-primary">{a.communication.fluency.coherenceRate ?? '—'}%</div>
                      <div className="label-blueprint">Advanced the case</div>
                    </div>
                    <div className="bg-surface-container-low rounded-lg p-3">
                      <div className="font-headline font-bold text-lg text-primary">{a.communication.fluency.firstResponseRate ?? '—'}%</div>
                      <div className="label-blueprint">Answered on first try</div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {[
                    ['Words/min', metrics.wordsPerMinute],
                    ['Filler words', metrics.fillerWordTotal],
                    ['Concise rate', (metrics.substantiveConciseRate ?? metrics.conciseAnswerRate) != null ? `${metrics.substantiveConciseRate ?? metrics.conciseAnswerRate}%` : '—'],
                    ['Long pauses', metrics.longPauses],
                    ['Repeated phrases', metrics.repeatedPhrases],
                    ['Avg response', metrics.avgWordsPerResponse != null ? `${metrics.avgWordsPerResponse}w` : '—'],
                    ['Longest response', metrics.longestResponseWords != null ? `${metrics.longestResponseWords}w` : '—'],
                  ].map(([label, val]) => (
                    <div key={label as string} className="bg-surface-container-low rounded-lg p-3">
                      <div className="font-headline font-bold text-lg text-primary">{val ?? '—'}</div>
                      <div className="label-blueprint">{label}</div>
                    </div>
                  ))}
                </div>
                {/* Pause distribution — WHERE they clustered, not just the count */}
                {metrics.pauseDistribution && metrics.longPauses > 0 && (
                  <p className="text-xs text-secondary mb-4">
                    Pauses clustered: <span className="text-on-surface-variant font-medium">{metrics.pauseDistribution.early} early</span> · <span className="text-on-surface-variant font-medium">{metrics.pauseDistribution.mid} mid</span> · <span className="text-on-surface-variant font-medium">{metrics.pauseDistribution.late} late</span>
                  </p>
                )}
                {(metrics.fillerWords ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {metrics.fillerWords.map((f: any, i: number) => (
                      <span key={i} className="text-xs bg-surface-container px-2 py-1 rounded-md text-on-surface-variant">“{f.word}” × {f.count}</span>
                    ))}
                  </div>
                )}
                {/* Most impactful repetitions with context */}
                {(a.communication?.fluency?.topRepetitions ?? []).length > 0 && (
                  <div className="space-y-1.5 mb-4">
                    {a.communication.fluency.topRepetitions.map((r: any, i: number) => (
                      <div key={i} className="text-xs flex gap-2">
                        <span className="font-mono text-on-tertiary-container shrink-0">{r.timestamps}</span>
                        <span className="text-secondary">“{r.phrase}” — {r.note}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  {(a.communication?.fluency?.observations ?? []).map((o: any, i: number) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="font-mono text-on-tertiary-container shrink-0">{o.timestamp}</span>
                      <span className="text-secondary">{o.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Vocabulary */}
              <div className="no-line-card p-6">
                <h4 className="font-bold text-primary mb-2">Vocabulary &amp; Executive Communication</h4>
                <p className="text-sm text-on-surface-variant mb-3">{a.communication?.vocabulary?.assessment}</p>
                {a.communication?.vocabulary?.weakExample && (
                  <div className="text-xs space-y-1">
                    <div className="text-error">Weak: “{a.communication.vocabulary.weakExample}”</div>
                    <div className="text-green-700">Better: “{a.communication.vocabulary.betterExample}”</div>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Time Management v2 — causal impact chain (spec §6) */}
          <Section id="time" title="Time Management" tab="coaching" activeTab={activeTab}>
            <div className="space-y-3">
              {(a.timeManagement ?? []).map((t: any, i: number) => {
                const bad = /short|brief|limited|insufficient|long/i.test(t.assessment ?? '');
                return (
                  <div key={i} className="no-line-card p-4">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="text-primary font-bold text-sm">{t.stage}</span>
                      <span className="font-mono text-xs text-on-surface-variant">{t.timeSpent}</span>
                      <span className="text-xs text-secondary">vs {t.recommended}</span>
                      <span className={cn('text-xs font-bold ml-auto', bad ? 'text-amber-600' : 'text-green-700')}>{t.assessment}</span>
                    </div>
                    {t.impactChain && <p className="text-sm text-on-surface-variant leading-relaxed mt-1">{t.impactChain}</p>}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Missed Opportunities v2 — four-part coaching format (spec §7) */}
          <Section id="missed" title="Missed Opportunities" tab="coaching" activeTab={activeTab}>
            <div className="space-y-4">
              {(a.missedOpportunities ?? []).map((m: any, i: number) => (
                <div key={i} className="no-line-card p-5 border-l-4 border-amber-400 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-on-tertiary-container">{m.timestamp}</span>
                    {m.habitTag && <span className="text-[10px] text-secondary bg-surface-container-low px-1.5 py-0.5 rounded">{String(m.habitTag).replace(/_/g, ' ')}</span>}
                  </div>
                  {m.setup ? (
                    <>
                      <p className="text-sm text-on-surface-variant"><span className="font-bold text-primary">The setup: </span>{m.setup}</p>
                      <p className="text-sm text-on-surface-variant"><span className="font-bold text-amber-700">Your move: </span>{m.yourMove}</p>
                      <p className="text-sm text-on-surface-variant"><span className="font-bold text-error">The gap: </span>{m.gap}</p>
                      <p className="text-sm text-on-surface-variant bg-surface-container-low rounded-lg p-3"><span className="font-bold text-green-700">Practice pattern: </span>{m.practicePattern}</p>
                    </>
                  ) : (
                    /* legacy shape */
                    <>
                      {m.situation && <p className="text-xs font-bold text-primary">{m.situation}</p>}
                      {m.candidateResponse && <p className="text-xs text-secondary">You: “{m.candidateResponse}”</p>}
                      {m.missed && <p className="text-sm text-error"><span className="font-bold">Missed:</span> {m.missed}</p>}
                      {m.better && <p className="text-sm text-green-700"><span className="font-bold">Better:</span> {m.better}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Hint Dependency */}
          <Section id="hints" title="Hint &amp; Assistance Dependency" tab="communication" activeTab={activeTab}>
            <div className="no-line-card p-6 flex flex-col sm:flex-row gap-6 items-center">
              <div className="flex gap-6">
                <div className="text-center"><div className="font-headline text-3xl font-extrabold text-primary">{a.hintDependency?.hintsUsed ?? 0}</div><div className="label-blueprint">Hints used</div></div>
                <div className="text-center"><div className="font-headline text-3xl font-extrabold text-primary">{a.hintDependency?.independentRate ?? '—'}%</div><div className="label-blueprint">Independent</div></div>
              </div>
              <p className="text-sm text-on-surface-variant flex-grow">{a.hintDependency?.assessment}</p>
            </div>
          </Section>

          {/* Ideal Answers v2 — three-layer comparison + quality gate (spec §3) */}
          <Section id="ideal" title="Ideal Answer Comparison" tab="ideal" activeTab={activeTab}>
            <div className="space-y-5">
              {(a.idealAnswers ?? []).map((q: any, i: number) => (
                <div key={i} className="no-line-card p-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-primary text-sm">{q.question}</p>
                    {q.similarityScore != null && (
                      <span className="text-[10px] font-mono text-secondary shrink-0 mt-0.5" title="Similarity between your answer and the model answer">sim {q.similarityScore}</span>
                    )}
                  </div>
                  {/* Layer 1: what it tests */}
                  {q.skillTested && (
                    <p className="text-xs text-on-tertiary-container"><span className="font-bold">What this tests: </span>{q.skillTested}</p>
                  )}
                  <div className="bg-surface-container-low rounded-lg p-3">
                    <div className="label-blueprint mb-1">Your answer</div>
                    <p className="text-sm text-on-surface-variant">{q.candidateAnswer}</p>
                  </div>
                  {/* Layer 2: diagnosis (legacy: assessment) */}
                  {(q.diagnosis || q.assessment) && (
                    <p className="text-xs text-amber-700 italic">{q.diagnosis || q.assessment}</p>
                  )}
                  {/* Layer 3: model answer with reasoning — or "on target" when already strong */}
                  {q.alreadyStrong ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="label-blueprint mb-1 text-green-700">Your response was on target ✓</div>
                      <p className="text-sm text-on-surface-variant">{q.modelAnswer || q.strongerAnswer ? `A marginal improvement: ${q.modelAnswer || q.strongerAnswer}` : 'Strong as-is.'}</p>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="label-blueprint mb-1 text-green-700">Model answer — with the reasoning</div>
                      <p className="text-sm text-on-surface-variant">{q.modelAnswer || q.strongerAnswer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Improvement Plan v2 — max 2 priorities, each with evidence/drill/criteria (spec §8) */}
          <Section id="plan" title="Priority Improvement Plan" tab="overview" activeTab={activeTab} action={<span className="label-blueprint">two specific items beat four generic ones</span>}>
            <div className="space-y-3">
              {((a.improvementPlan ?? a.priorityPlan) ?? []).slice(0, 2).map((p: any, i: number) => (
                <div key={i} className="no-line-card p-4 flex gap-4 items-start">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold shrink-0',
                    p.priority === 'P0' ? 'bg-error-container text-on-error-container' : p.priority === 'P1' ? 'bg-amber-100 text-amber-800' : 'bg-surface-container text-secondary')}>
                    {p.priority ?? `#${i + 1}`}
                  </span>
                  <div className="flex-grow space-y-2">
                    <p className="text-sm font-bold text-primary">{p.action}</p>
                    {/* v2: evidence excerpt; legacy: detail */}
                    {(p.evidenceExcerpt || p.detail) && (
                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        {p.evidenceExcerpt && <span className="font-bold text-on-tertiary-container">Evidence: </span>}
                        {p.evidenceExcerpt || p.detail}
                      </p>
                    )}
                    {(p.practiceDrill || p.practiceMethod) && (
                      <p className="text-xs text-secondary leading-relaxed">
                        <span className="font-bold text-on-tertiary-container">Practice drill: </span>{p.practiceDrill || p.practiceMethod}
                      </p>
                    )}
                    {p.completionCriteria && (
                      <p className="text-xs text-secondary leading-relaxed">
                        <span className="font-bold text-green-700">Done when: </span>{p.completionCriteria}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Case Map — the candidate's actual journey overlaid on the MECE answer key */}
          {a.evaluationTree && (
            <Section id="casemap" title="Case Map" tab="casemap" activeTab={activeTab} action={<span className="label-blueprint">your path vs. the answer key</span>}>
              <div className="space-y-4">
                {a.treeScore && (
                  <div className="no-line-card p-5 flex items-center gap-5">
                    <div className="text-center shrink-0">
                      <div className="font-headline text-3xl font-extrabold text-primary leading-none">{a.treeScore.percentage}%</div>
                      <div className="label-blueprint mt-1">{a.treeScore.total}/{a.treeScore.max} pts</div>
                    </div>
                    <div className="flex-grow">
                      <div className="font-bold text-primary">{a.treeScore.grade}</div>
                      <p className="text-xs text-secondary mt-0.5">Deterministic traversal score — points for the nodes you reached, in what order, minus wrong turns, dead ends and nudges. Open the map for the full breakdown.</p>
                    </div>
                  </div>
                )}
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
                <p className="text-[11px] text-secondary">Opens full-screen: click any node to see the right move there and how you did; double-click to collapse a branch; use the minimap and zoom slider to navigate.</p>
              </div>
            </Section>
          )}

          {solution && Array.isArray(solution.exhibits) && solution.exhibits.length > 0 && (
            <Section id="exhibits" title="Exhibits &amp; Quant" tab="exhibits" activeTab={activeTab} action={<span className="label-blueprint">what the data showed</span>}>
              <div className="space-y-4">
                {solution.exhibits.map((e: any, i: number) => (
                  <div key={i} className="no-line-card p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-headline font-bold text-sm text-primary">{e.label ?? `Exhibit ${i + 1}`}</span>
                      {e.visual && <span className="text-[10px] uppercase tracking-wide text-secondary bg-surface-container-low px-1.5 py-0.5 rounded">{e.visual}</span>}
                    </div>
                    {e.data && <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line font-mono bg-surface-container-lowest rounded-lg p-3">{e.data}</p>}
                    {e.insight && <p className="text-xs text-on-tertiary-container mt-2"><span className="font-bold">What it reveals: </span>{e.insight}</p>}
                  </div>
                ))}

                {solution.quant && (solution.quant.task || solution.quant.derivation) && (
                  <div className="no-line-card p-5 border-l-4 border-on-tertiary-container">
                    <p className="label-blueprint text-on-tertiary-container font-bold mb-2">The quant</p>
                    {solution.quant.task && <p className="text-sm font-bold text-primary mb-2">{solution.quant.task}</p>}
                    {solution.quant.derivation && <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line mb-2">{solution.quant.derivation}</p>}
                    {solution.quant.answer && (
                      <p className="text-sm text-primary bg-green-50 border border-green-200 rounded-lg p-3"><span className="font-bold text-green-700">Answer: </span>{solution.quant.answer}</p>
                    )}
                  </div>
                )}

                {Array.isArray(solution.commonWrongTurns) && solution.commonWrongTurns.length > 0 && (
                  <div className="no-line-card p-5">
                    <p className="label-blueprint text-error font-bold mb-2">Common wrong turns</p>
                    <ul className="space-y-1.5 text-sm text-on-surface-variant">
                      {solution.commonWrongTurns.map((w: string, i: number) => (
                        <li key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Model Solution — the candidate's actual answer vs. the answer key */}
          {(a.candidateSolution || (solution && (solution.plausibleSolution || solution.solutionTree))) && (
            <Section id="solution" title="Model Solution" tab="solution" activeTab={activeTab} action={<span className="label-blueprint">your answer vs. the answer key</span>}>
              <div className="space-y-4">
                {a.candidateSolution && (
                  <div className="no-line-card p-6 border-l-4 border-amber-400">
                    <p className="label-blueprint text-amber-700 font-bold mb-2">Your solution</p>
                    <p className="text-sm text-primary leading-relaxed whitespace-pre-line">{a.candidateSolution}</p>
                  </div>
                )}
                {solution?.plausibleSolution && (
                  <div className="no-line-card p-6 border-l-4 border-on-tertiary-container">
                    <p className="label-blueprint text-on-tertiary-container font-bold mb-2">The model recommendation</p>
                    <p className="text-sm text-primary leading-relaxed">{solution.plausibleSolution}</p>
                  </div>
                )}
                {solution?.solutionTree && (
                  <div className="no-line-card p-6">
                    <p className="label-blueprint text-secondary font-bold mb-4">How a strong candidate gets there — solution tree</p>
                    <SolutionNode node={solution.solutionTree} />
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Ideal Interview Script */}
          {solution && Array.isArray(solution.idealScript) && solution.idealScript.length > 0 && (
            <Section id="script" title="Ideal Interview Script" tab="ideal" activeTab={activeTab} action={<span className="label-blueprint">how it should have flowed</span>}>
              <div className="space-y-3">
                {solution.idealScript.map((s: any, i: number) => (
                  <div key={i} className="no-line-card p-5">
                    {s.stage && <p className="label-blueprint text-on-tertiary-container font-bold mb-2">{s.stage}</p>}
                    {s.interviewer && (
                      <p className="text-sm text-primary mb-2"><span className="font-bold">Interviewer:</span> {s.interviewer}</p>
                    )}
                    {s.idealResponse && (
                      <p className="text-sm text-on-surface-variant leading-relaxed border-l-2 border-outline-variant/40 pl-3">
                        <span className="font-bold text-secondary">Strong answer:</span> {s.idealResponse}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Progress */}
          <Section id="progress" title="Progress Over Time" tab="progress" activeTab={activeTab}>
            {progress.length < 2 ? (
              <div className="no-line-card p-6 text-sm text-secondary">This is your first scored interview — complete more cases to track your trend.</div>
            ) : (
              <div className="no-line-card p-6">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={progress.map((p, i) => ({ ...p, n: i + 1 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" />
                    <XAxis dataKey="n" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="overallScore" name="Overall" stroke="#002046" strokeWidth={2} />
                    <Line type="monotone" dataKey="structuring" name="Structuring" stroke="#08aae4" strokeWidth={1.5} />
                    <Line type="monotone" dataKey="quantitative" name="Quant" stroke="#ba1a1a" strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-secondary mt-3">Overall, structuring and quantitative reasoning across your last {progress.length} interviews.</p>
              </div>
            )}
          </Section>
        </div>

        {/* RIGHT: interactive transcript */}
        <div className="xl:col-span-1">
          <div className="xl:sticky xl:top-32 no-line-card flex flex-col max-h-[calc(100vh-10rem)]">
            <div className="p-4 border-b border-outline-variant/15 shrink-0">
              <h3 className="font-headline font-bold text-primary mb-3">Interactive Transcript</h3>
              <div className="flex flex-wrap gap-1.5">
                {TRANSCRIPT_FILTERS.map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('px-2 py-1 rounded text-[11px] font-medium transition',
                    filter === f ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-secondary hover:text-primary')}>
                    {f}
                  </button>
                ))}
              </div>
              {/* Momentum legend (spec §10) */}
              <div className="flex items-center gap-3 mt-2.5 text-[10px] text-secondary">
                <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-green-500" /> driving</span>
                <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-400" /> redirected</span>
                <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-error" /> stalling</span>
              </div>
            </div>
            <div className="overflow-y-auto scrolling-log p-4 space-y-4">
              {filteredTurns.length === 0 && <p className="text-xs text-secondary italic">No turns match this filter.</p>}
              {filteredTurns.map((t, i) => {
                const coach = coachByTs.get(String(t.timestamp));
                const coachOpen = openCoach.has(i);
                const mom = t.momentum as string | undefined;
                // Momentum (spec §10): GREEN driving · YELLOW interviewer redirecting · RED stalling
                const momBorder = mom === 'GREEN' ? 'border-green-500' : mom === 'RED' ? 'border-error' : mom === 'YELLOW' ? 'border-amber-400' : 'border-outline-variant/20';
                return (
                  <div key={i} className={cn('space-y-1.5 group pl-3 border-l-2', momBorder)}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-on-tertiary-container font-mono">
                        [{t.timestamp}] {t.role === 'candidate' ? 'YOU' : 'PARTNER'}
                      </span>
                      <button onClick={() => setBookmarks((s) => toggle(s, i))} className={cn('transition', bookmarks.has(i) ? 'text-on-tertiary-container' : 'text-secondary/40 hover:text-secondary')}>
                        <Bookmark className="w-3.5 h-3.5" fill={bookmarks.has(i) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    {/* Interviewer intent label (spec §10) */}
                    {t.role === 'interviewer' && t.intent && (
                      <span className="inline-block text-[10px] font-medium text-on-tertiary-container bg-tertiary-fixed/40 px-1.5 py-0.5 rounded">Testing: {t.intent}</span>
                    )}
                    <p className="text-sm text-on-surface-variant leading-relaxed">{t.text}</p>
                    {(t.markers ?? []).map((m: any, j: number) => (
                      <div key={j} className={cn('flex gap-1.5 text-xs', m.type === 'strength' ? 'text-green-700' : 'text-amber-700')}>
                        {m.type === 'strength' ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                        <span>{m.note}</span>
                      </div>
                    ))}
                    {(t.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {t.tags.map((tag: string, j: number) => (
                          <span key={j} className="text-[10px] text-secondary bg-surface-container-low px-1.5 py-0.5 rounded">#{tag}</span>
                        ))}
                      </div>
                    )}
                    {/* Expandable four-part coaching when this moment was a missed opportunity (spec §10) */}
                    {coach && (
                      <div>
                        <button onClick={() => setOpenCoach((s) => toggle(s, i))} className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline">
                          <AlertTriangle className="w-3 h-3" /> Coaching note <ChevronDown className={cn('w-3 h-3 transition-transform', coachOpen && 'rotate-180')} />
                        </button>
                        {coachOpen && (
                          <div className="mt-2 space-y-1.5 bg-surface-container-low rounded-lg p-3 text-xs leading-relaxed">
                            {coach.setup && <p><span className="font-bold text-primary">Setup: </span><span className="text-on-surface-variant">{coach.setup}</span></p>}
                            {coach.yourMove && <p><span className="font-bold text-amber-700">Your move: </span><span className="text-on-surface-variant">{coach.yourMove}</span></p>}
                            {coach.gap && <p><span className="font-bold text-error">The gap: </span><span className="text-on-surface-variant">{coach.gap}</span></p>}
                            {coach.practicePattern && <p><span className="font-bold text-green-700">Practice: </span><span className="text-on-surface-variant">{coach.practicePattern}</span></p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

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
          <Link to="/config" className="flex-1 sm:flex-none flex items-center gap-2 px-5 py-3 border border-outline-variant/20 text-primary font-bold rounded-lg hover:bg-surface-container-low transition justify-center">
            <RefreshCw className="w-4 h-4" /> Retry Case
          </Link>
          <Link to="/config" className="flex-1 sm:flex-none flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-bold rounded-lg hover:bg-primary-container transition justify-center">
            Practise Similar Case <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Full-case modal — the complete brief + exhibits the candidate worked from */}
      {showCase && caseBrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setShowCase(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
                  <div className="space-y-3">
                    {solution.exhibits.map((e: any, i: number) => (
                      <div key={i} className="bg-surface-container-low rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-primary">{e.label ?? `Exhibit ${i + 1}`}</span>
                          {e.visual && <span className="text-[10px] uppercase tracking-wide text-secondary bg-surface-container px-1.5 py-0.5 rounded">{e.visual}</span>}
                        </div>
                        {e.data && <p className="text-xs text-on-surface-variant leading-relaxed whitespace-pre-line font-mono">{e.data}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
