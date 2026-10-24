import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, Check, FileText, Headphones, Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { api } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.docx';

// Generic on purpose: we can't read a resume without a backend, so we never pretend to know what's in one.
const TOPICS = [
  { title: 'Work experience', sub: 'Roles, scope, and what you actually owned' },
  { title: 'Internships', sub: 'What you did, and what changed because of you' },
  { title: 'Projects & case work', sub: 'Decisions, trade-offs, results' },
  { title: 'Leadership & extracurriculars', sub: 'Teams, budgets, influence' },
  { title: 'Education & motivation', sub: 'Why this path, why this role' },
];

const ROLES = [
  { title: 'Consulting', sub: 'Impact, problem solving, client stories' },
  { title: 'Product Management', sub: 'Ownership, metrics, user decisions' },
  { title: 'Finance / IB', sub: 'Deals, valuation, attention to detail' },
  { title: 'Sales & Marketing', sub: 'Targets, campaigns, customer insight' },
  { title: 'Operations', sub: 'Processes, efficiency, execution' },
  { title: 'HR', sub: 'People, culture, talent decisions' },
];

const DURATIONS = ['15 min', '25 min', '40 min'];
const DURATION_MINUTES = [15, 25, 40];
const STYLES = ['Supportive', 'Neutral', 'Stress'];

// What the user sees while the server reads the resume and briefs the interviewer.
const PREP_STEPS = ['Reading your resume…', 'Picking what to probe…', 'Briefing your interviewer…'];
const PREP_STEPS_SAVED = ['Loading your resume…', 'Briefing your interviewer…'];

const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);

interface SavedResume {
  id: string;
  fileName: string;
  fileSize: number;
  candidateName: string;
  headline: string;
  highlights: string[];
  uploadedAt: string;
  lastUsedAt: string;
}

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const isAllowed = (f: File) => /\.(pdf|docx)$/i.test(f.name);

const choiceCls = (on: boolean) => cn(
  'text-left rounded-xl border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
  on
    ? 'border-on-tertiary-container bg-on-tertiary-container/10'
    : 'border-outline-variant/25 bg-surface-container-lowest hover:border-on-tertiary-container/50',
);

export default function ResumeInterview() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [topics, setTopics] = useState<Set<number>>(new Set([0, 1, 2]));
  const [role, setRole] = useState(0);
  const [dur, setDur] = useState(1);
  const [style, setStyle] = useState(1);
  const [starting, setStarting] = useState(false);
  const [prepStep, setPrepStep] = useState(0);
  const [startError, setStartError] = useState('');
  // Resumes uploaded on earlier interviews: the latest is preselected so a returning user just continues.
  const [saved, setSaved] = useState<SavedResume[] | null>(null); // null = still loading
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get<{ resumes: SavedResume[] }>('/resume-interviews/resumes')
      .then(({ resumes }) => {
        if (!live) return;
        setSaved(resumes);
        setSelectedId(resumes[0]?.id ?? null);
      })
      .catch(() => { if (live) setSaved([]); }); // listing is a convenience: fall back to plain upload
    return () => { live = false; };
  }, []);

  const removeSaved = async (id: string) => {
    try {
      await api.del(`/resume-interviews/resumes/${id}`);
      const rest = (saved ?? []).filter((r) => r.id !== id);
      setSaved(rest);
      if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that resume.');
    } finally {
      setRemovingId(null);
    }
  };

  // Advance the status line while the request is in flight (never past the last step).
  useEffect(() => {
    if (!starting) return;
    setPrepStep(0);
    const t = setInterval(() => setPrepStep((n) => Math.min(n + 1, PREP_STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [starting]);

  const pick = () => inputRef.current?.click();

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    if (!isAllowed(f)) { setError('That file type won\'t work. Upload a PDF or DOCX.'); return; }
    if (f.size > MAX_BYTES) { setError('That file is over the 5 MB limit. Try a smaller one.'); return; }
    setError('');
    setStartError('');
    setFile(f);
    setSelectedId(null); // a fresh upload replaces the saved choice
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0]);
  };

  const onZoneKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  };

  const toggleTopic = (i: number) => {
    setStartError('');
    setTopics((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };

  const hasResume = !!file || !!selectedId;
  const ready = hasResume && topics.size > 0 && !starting;

  const begin = async () => {
    if (!hasResume || topics.size === 0 || starting) return;
    setStartError('');
    setStarting(true);
    try {
      const fd = new FormData();
      if (file) fd.append('resume', file);
      else if (selectedId) fd.append('resumeId', selectedId);
      fd.append('role', ROLES[role].title);
      fd.append('topics', JSON.stringify([...topics].sort()));
      fd.append('durationMinutes', String(DURATION_MINUTES[dur]));
      fd.append('style', STYLES[style].toLowerCase());
      const { sessionId } = await api.postForm<{ sessionId: string }>('/resume-interviews', fd);
      navigate(`/session/resume/${sessionId}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setStarting(false);
    }
  };
  const summary = !hasResume
    ? 'Choose or upload a resume to continue'
    : topics.size === 0
      ? 'Pick at least one topic'
      : `~${DURATIONS[dur]} · spoken interview · ${topics.size} of ${TOPICS.length} topics`;

  return (
    <div className="max-w-3xl mx-auto py-1">
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-headline text-xl font-extrabold text-primary">New resume interview</h1>
        </div>
        <p className="text-secondary text-sm mt-1 max-w-xl">
          Upload your resume and pick a target role. The interviewer will read it and probe your experiences the way a real panel would.
        </p>
      </header>

      {/* Resume */}
      <section className="mt-6">
        <label className="label-blueprint block">Resume</label>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }}
        />

        {saved === null && (
          <div className="mt-2.5 h-[68px] rounded-xl bg-surface-container-low animate-pulse" aria-hidden="true" />
        )}

        {saved !== null && saved.length > 0 && !file && (
          <div role="radiogroup" aria-label="Your saved resumes" className="mt-2.5 space-y-2">
            {saved.map((r) => {
              const on = selectedId === r.id;
              return (
                <div key={r.id} className={cn('rounded-xl border flex items-stretch transition', on ? 'border-on-tertiary-container bg-on-tertiary-container/10' : 'border-outline-variant/25 bg-surface-container-lowest hover:border-on-tertiary-container/50')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { setSelectedId(r.id); setStartError(''); }}
                    className="flex-1 min-w-0 text-left flex items-start gap-3.5 px-4 py-3.5 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50"
                  >
                    <span className="w-10 h-10 rounded-lg bg-surface-container-lowest text-on-tertiary-container flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-headline font-bold text-[14.5px] text-primary truncate">{r.fileName}</span>
                        {on && <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-on-tertiary-container"><Check className="w-3 h-3" strokeWidth={3} /> Selected</span>}
                      </span>
                      <span className="block text-[12.5px] text-secondary truncate">
                        {r.headline || 'Resume'} · uploaded {ago(r.uploadedAt)}
                      </span>
                      {r.highlights.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {r.highlights.map((h) => (
                            <span key={h} className="text-[11px] text-secondary bg-surface-container-low rounded-full px-2 py-0.5 max-w-[220px] truncate">{h}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  {removingId === r.id ? (
                    <div className="flex items-center gap-2 pr-3 shrink-0">
                      <button type="button" onClick={() => removeSaved(r.id)} className="text-[12.5px] font-bold text-error hover:underline">Remove</button>
                      <button type="button" onClick={() => setRemovingId(null)} className="text-[12.5px] font-semibold text-secondary hover:text-primary">Keep</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemovingId(r.id)}
                      aria-label={`Remove ${r.fileName}`}
                      className="px-3.5 text-secondary/60 hover:text-error transition shrink-0 rounded-r-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
            <button type="button" onClick={() => setShowUpload((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-tertiary-container hover:underline pt-1">
              {showUpload ? 'Hide upload' : <><Plus className="w-4 h-4" /> Use a different resume</>}
            </button>
          </div>
        )}

        {saved !== null && !file && (saved.length === 0 || showUpload) && (
          <div
            role="button"
            tabIndex={0}
            onClick={pick}
            onKeyDown={onZoneKey}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-label="Upload your resume"
            className={cn(
              'mt-2.5 rounded-xl border-[1.5px] border-dashed bg-surface-container-lowest px-5 py-8 flex flex-col items-center gap-2 cursor-pointer transition',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
              dragging
                ? 'border-on-tertiary-container bg-on-tertiary-container/[0.06]'
                : 'border-on-tertiary-container/40 hover:border-on-tertiary-container hover:bg-on-tertiary-container/[0.04]',
            )}
          >
            <span className="w-11 h-11 rounded-xl bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
              <UploadCloud className="w-[22px] h-[22px]" />
            </span>
            <div className="font-headline font-bold text-[14.5px] text-primary text-center">
              Drop your resume here, or <span className="text-on-tertiary-container">browse</span>
            </div>
            <div className="text-[12.5px] text-secondary text-center">PDF or DOCX, up to 5 MB · One page works best</div>
          </div>
        )}

        {file && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2.5 rounded-xl border border-on-tertiary-container/40 bg-on-tertiary-container/10 px-4 py-3.5 flex items-center gap-3.5"
          >
            <span className="w-10 h-10 rounded-lg bg-surface-container-lowest text-on-tertiary-container flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-headline font-bold text-[14.5px] text-primary truncate">{file.name}</div>
              <div className="text-[12.5px] text-secondary">{fmtSize(file.size)} · {/\.pdf$/i.test(file.name) ? 'PDF' : 'DOCX'}</div>
            </div>
            <button type="button" onClick={pick} className="text-[13px] font-semibold text-on-tertiary-container hover:underline shrink-0">
              Replace
            </button>
            {(saved?.length ?? 0) > 0 && (
              <button type="button" onClick={() => { setFile(null); setSelectedId(saved![0].id); setShowUpload(false); }} className="text-[13px] font-semibold text-secondary hover:text-primary shrink-0">
                Use saved
              </button>
            )}
          </motion.div>
        )}

        {error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] text-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <AnimatePresence initial={false}>
          {hasResume && (
            <motion.div
              key="topics"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 no-line-card p-4">
                <div className="text-[13px] text-secondary">
                  What should the interviewer dig into? <span className="text-secondary/60">Pick at least one.</span>
                </div>
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {TOPICS.map((t, i) => {
                    const on = topics.has(i);
                    return (
                      <button
                        key={t.title}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleTopic(i)}
                        className={cn('flex gap-2.5 items-start px-3 py-2.5', choiceCls(on))}
                      >
                        <span className={cn(
                          'w-4 h-4 mt-0.5 shrink-0 rounded-[4px] border-[1.5px] flex items-center justify-center transition',
                          on ? 'bg-on-tertiary-container border-on-tertiary-container' : 'bg-surface-container-lowest border-outline-variant',
                        )}>
                          {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-primary">{t.title}</span>
                          <span className="block text-[12px] text-secondary leading-snug">{t.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Target role */}
      <section className="mt-6">
        <label className="label-blueprint block">Target role</label>
        <div className="mt-2.5 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {ROLES.map((r, i) => (
            <button
              key={r.title}
              type="button"
              aria-pressed={role === i}
              onClick={() => { setRole(i); setStartError(''); }}
              className={cn('p-3.5', choiceCls(role === i))}
            >
              <span className="block font-headline font-bold text-[15px] text-primary">{r.title}</span>
              <span className="block text-[12px] text-secondary mt-0.5 leading-snug">{r.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Duration + style */}
      <section className="mt-6 space-y-6">
        {([
          ['Duration', DURATIONS, dur, setDur],
          ['Interviewer style', STYLES, style, setStyle],
        ] as const).map(([label, options, value, set]) => (
          <div key={label}>
            <label className="label-blueprint block">{label}</label>
            <div className="mt-2.5 flex gap-2.5 max-w-md">
              {options.map((o, i) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={value === i}
                  onClick={() => { set(i); setStartError(''); }}
                  className={cn('flex-1 py-2.5 text-[13.5px] font-medium', choiceCls(value === i), 'text-center', value === i && 'text-primary font-semibold')}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Sticky action bar */}
      <div className="mt-7 sticky bottom-0 z-10 bg-surface/95 backdrop-blur border-t border-outline-variant/20 pt-4 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-secondary">{summary}</div>
          <button
            type="button"
            disabled={!ready}
            onClick={begin}
            className={cn(
              'inline-flex items-center gap-2.5 px-6 py-3 rounded-lg font-headline font-bold text-[14.5px] text-white transition',
              ready ? 'bg-primary hover:bg-primary-container active:scale-[0.98]' : 'bg-[#94a3b8] cursor-not-allowed',
            )}
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {starting ? 'Starting…' : <>Begin interview <ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>
        {startError && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-error-container/50 text-error text-[12.5px] px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {startError}
              {/credit/i.test(startError) && <> <Link to="/billing" className="font-bold underline">View plans</Link></>}
            </span>
          </p>
        )}
      </div>

      {/* Preparing overlay: the resume is being read and the interviewer briefed. */}
      <AnimatePresence>
        {starting && (
          <motion.div
            key="prep"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
            aria-live="polite"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/40 backdrop-blur-sm p-4"
          >
            <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-7 w-[min(420px,94vw)] text-center">
              <span className="mx-auto w-12 h-12 rounded-xl bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin" />
              </span>
              <div className="mt-4 font-headline font-bold text-primary text-[16px]">{(file ? PREP_STEPS : PREP_STEPS_SAVED)[Math.min(prepStep, (file ? PREP_STEPS : PREP_STEPS_SAVED).length - 1)]}</div>
              <div className="mt-1 text-[12.5px] text-secondary">This takes a few seconds.</div>
              <p className="mt-5 flex items-start gap-2 text-left text-[12px] text-secondary bg-surface-container-low rounded-lg px-3 py-2">
                <Headphones className="w-4 h-4 shrink-0 mt-0.5 text-on-tertiary-container" />
                It is a spoken interview. Use headphones in a quiet spot and allow the microphone when your browser asks.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
