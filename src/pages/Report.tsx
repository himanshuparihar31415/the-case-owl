import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle, AlertCircle, AlertTriangle, Loader2, ArrowRight, Download,
  RefreshCw, Play, Bookmark, ChevronDown,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/src/lib/api';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

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

function Section({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-headline text-xl font-bold text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const SECTIONS = [
  ['overall', 'Overall Assessment'],
  ['competencies', 'Competency Matrix'],
  ['communication', 'Communication Quality'],
  ['time', 'Time Management'],
  ['missed', 'Missed Opportunities'],
  ['hints', 'Hint Dependency'],
  ['ideal', 'Ideal Answers'],
  ['plan', 'Improvement Plan'],
  ['progress', 'Progress Over Time'],
] as const;

const TRANSCRIPT_FILTERS = ['All', 'Strengths', 'Critical Issues', 'Grammar', 'Quantitative', 'Missed Opportunities', 'Hint Usage'] as const;
type Filter = typeof TRANSCRIPT_FILTERS[number];

export default function Report() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [fullTranscript, setFullTranscript] = useState<Array<{ role: string; text: string; timestamp?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedComp, setExpandedComp] = useState<Set<number>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    if (!sessionId) return;
    api.get<{ report: ReportData; transcript: Array<{ role: string; text: string; timestamp?: string }> }>(`/reports/${sessionId}`)
      .then((data) => { setReport(data.report); setFullTranscript(data.transcript ?? []); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load report.'); setLoading(false); });
  }, [sessionId]);

  // Build a plain-text transcript and trigger a download. mm:ss is relative to
  // the first turn so the timestamps line up with the report's evidence.
  const downloadTranscript = () => {
    if (!fullTranscript.length) return;
    const start = fullTranscript[0]?.timestamp ? new Date(fullTranscript[0].timestamp).getTime() : 0;
    const stamp = (ts?: string) => {
      if (!ts || !start) return '  -  ';
      const s = Math.max(0, Math.floor((new Date(ts).getTime() - start) / 1000));
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const title = (report as any)?.caseTitle || a?.caseTitle || 'Case Interview';
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
        </div>
        <div className="flex items-center gap-5">
          <div className={cn('px-3 py-1.5 rounded-full text-sm font-bold', READINESS_COLOR[readiness] ?? 'bg-surface-container text-primary')}>
            {readiness}
          </div>
          <div className="text-right">
            <div className="font-headline text-4xl font-extrabold text-primary leading-none">
              {score10.toFixed(1)}<span className="text-xl text-secondary">/10</span>
            </div>
            <div className="label-blueprint mt-1">Confidence: {a.overall?.confidence ?? '—'}</div>
          </div>
        </div>
      </header>

      {/* Section nav */}
      <nav className="sticky top-20 z-10 bg-surface/90 backdrop-blur-sm -mx-1 px-1 py-2 flex gap-1 overflow-x-auto scrolling-log border-b border-outline-variant/15">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-secondary hover:text-primary hover:bg-surface-container-low transition">
            {label}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* LEFT: report sections */}
        <div className="xl:col-span-2 space-y-14">
          {/* Overall */}
          <Section id="overall" title="Overall Assessment">
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
          <Section id="competencies" title="Core Competency Matrix" action={<span className="label-blueprint">click a row for evidence</span>}>
            <div className="space-y-3">
              {competencies.map((c, i) => {
                const open = expandedComp.has(i);
                return (
                  <div key={i} className="no-line-card overflow-hidden">
                    <button onClick={() => setExpandedComp((s) => toggle(s, i))} className="w-full p-4 flex items-center gap-4 text-left hover:bg-surface-container-low transition">
                      <ChevronDown className={cn('w-4 h-4 text-secondary transition-transform shrink-0', open && 'rotate-180')} />
                      <span className="font-bold text-sm text-primary w-48 shrink-0">{c.label}</span>
                      <div className="flex-grow h-2 bg-surface-container-highest rounded-full overflow-hidden">
                        <div className={cn('h-full', scoreColor(c.score))} style={{ width: `${(c.score ?? 0) * 10}%` }} />
                      </div>
                      <span className="font-headline font-bold text-primary w-12 text-right shrink-0">{c.score}/10</span>
                    </button>
                    {open && (
                      <div className="px-5 pb-5 pl-12 space-y-3">
                        <p className="text-sm text-on-surface-variant leading-relaxed">{c.assessment}</p>
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
          <Section id="communication" title="Communication Quality">
            <div className="space-y-6">
              {/* Grammar */}
              <div className="no-line-card p-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-primary">Grammar &amp; Correctness</h4>
                  <span className="font-headline font-bold text-primary">{a.communication?.grammar?.score}/10</span>
                </div>
                <p className="text-sm text-on-surface-variant mb-4">{a.communication?.grammar?.summary}</p>
                <div className="space-y-3">
                  {(a.communication?.grammar?.issues ?? []).map((g: any, i: number) => (
                    <div key={i} className="text-xs border-l-2 border-error/40 pl-3">
                      <div className="font-mono text-on-tertiary-container">{g.timestamp} · <span className="text-error not-italic font-bold">{g.issue}</span></div>
                      <div className="text-secondary line-through mt-0.5">“{g.statement}”</div>
                      <div className="text-on-surface-variant mt-0.5">→ “{g.better}”</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fluency */}
              <div className="no-line-card p-6">
                <h4 className="font-bold text-primary mb-1">Fluency</h4>
                <p className="text-[11px] text-secondary mb-4">Measured from the transcript &amp; timing (approximate — acoustic metrics arrive with audio analysis).</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {[
                    ['Words/min', metrics.wordsPerMinute],
                    ['Filler words', metrics.fillerWordTotal],
                    ['Concise rate', metrics.conciseAnswerRate != null ? `${metrics.conciseAnswerRate}%` : '—'],
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
                {(metrics.fillerWords ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {metrics.fillerWords.map((f: any, i: number) => (
                      <span key={i} className="text-xs bg-surface-container px-2 py-1 rounded-md text-on-surface-variant">“{f.word}” × {f.count}</span>
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

          {/* Time Management */}
          <Section id="time" title="Time Management">
            <div className="no-line-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-low text-secondary">
                  <tr className="text-left"><th className="p-3 font-medium">Stage</th><th className="p-3 font-medium">Spent</th><th className="p-3 font-medium">Recommended</th><th className="p-3 font-medium">Assessment</th></tr>
                </thead>
                <tbody>
                  {(a.timeManagement ?? []).map((t: any, i: number) => {
                    const bad = /short|brief|limited|insufficient|long/i.test(t.assessment ?? '');
                    return (
                      <tr key={i} className="border-t border-outline-variant/10">
                        <td className="p-3 text-primary font-medium">{t.stage}</td>
                        <td className="p-3 font-mono text-on-surface-variant">{t.timeSpent}</td>
                        <td className="p-3 text-secondary">{t.recommended}</td>
                        <td className={cn('p-3 font-medium', bad ? 'text-amber-600' : 'text-green-700')}>{t.assessment}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Missed Opportunities */}
          <Section id="missed" title="Missed Opportunities">
            <div className="space-y-4">
              {(a.missedOpportunities ?? []).map((m: any, i: number) => (
                <div key={i} className="no-line-card p-5 border-l-4 border-amber-400">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-on-tertiary-container">{m.timestamp}</span>
                    <span className="text-xs font-bold text-primary">{m.situation}</span>
                  </div>
                  <p className="text-xs text-secondary mb-1">You: “{m.candidateResponse}”</p>
                  <p className="text-sm text-error mb-1"><span className="font-bold">Missed:</span> {m.missed}</p>
                  <p className="text-sm text-green-700"><span className="font-bold">Better:</span> {m.better}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Hint Dependency */}
          <Section id="hints" title="Hint &amp; Assistance Dependency">
            <div className="no-line-card p-6 flex flex-col sm:flex-row gap-6 items-center">
              <div className="flex gap-6">
                <div className="text-center"><div className="font-headline text-3xl font-extrabold text-primary">{a.hintDependency?.hintsUsed ?? 0}</div><div className="label-blueprint">Hints used</div></div>
                <div className="text-center"><div className="font-headline text-3xl font-extrabold text-primary">{a.hintDependency?.independentRate ?? '—'}%</div><div className="label-blueprint">Independent</div></div>
              </div>
              <p className="text-sm text-on-surface-variant flex-grow">{a.hintDependency?.assessment}</p>
            </div>
          </Section>

          {/* Ideal Answers */}
          <Section id="ideal" title="Ideal Answer Comparison">
            <div className="space-y-5">
              {(a.idealAnswers ?? []).map((q: any, i: number) => (
                <div key={i} className="no-line-card p-6 space-y-3">
                  <p className="font-bold text-primary text-sm">{q.question}</p>
                  <div className="bg-surface-container-low rounded-lg p-3">
                    <div className="label-blueprint mb-1">Your answer</div>
                    <p className="text-sm text-on-surface-variant">{q.candidateAnswer}</p>
                  </div>
                  <p className="text-xs text-amber-700 italic">{q.assessment}</p>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="label-blueprint mb-1 text-green-700">Stronger answer</div>
                    <p className="text-sm text-on-surface-variant">{q.strongerAnswer}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Improvement Plan */}
          <Section id="plan" title="Priority Improvement Plan">
            <div className="space-y-3">
              {(a.priorityPlan ?? []).map((p: any, i: number) => (
                <div key={i} className="no-line-card p-4 flex gap-4 items-start">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold shrink-0',
                    p.priority === 'P0' ? 'bg-error-container text-on-error-container' : p.priority === 'P1' ? 'bg-amber-100 text-amber-800' : 'bg-surface-container text-secondary')}>
                    {p.priority}
                  </span>
                  <div className="flex-grow space-y-2">
                    <p className="text-sm font-bold text-primary">{p.action}</p>
                    {p.detail && <p className="text-sm text-on-surface-variant leading-relaxed">{p.detail}</p>}
                    {p.practiceMethod && (
                      <p className="text-xs text-secondary leading-relaxed">
                        <span className="font-bold text-on-tertiary-container">Practice drill: </span>{p.practiceMethod}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Progress */}
          <Section id="progress" title="Progress Over Time">
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
            </div>
            <div className="overflow-y-auto scrolling-log p-4 space-y-4">
              {filteredTurns.length === 0 && <p className="text-xs text-secondary italic">No turns match this filter.</p>}
              {filteredTurns.map((t, i) => (
                <div key={i} className="space-y-1.5 group">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-on-tertiary-container font-mono">
                      [{t.timestamp}] {t.role === 'candidate' ? 'YOU' : 'PARTNER'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button title="Audio playback (coming with audio analysis)" disabled className="text-secondary/30 cursor-not-allowed"><Play className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setBookmarks((s) => toggle(s, i))} className={cn('transition', bookmarks.has(i) ? 'text-on-tertiary-container' : 'text-secondary/40 hover:text-secondary')}>
                        <Bookmark className="w-3.5 h-3.5" fill={bookmarks.has(i) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
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
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
