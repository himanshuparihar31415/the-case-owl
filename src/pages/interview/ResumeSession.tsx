import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, FileText, Loader2, MessageSquare, Mic, MicOff, PhoneOff, Search, Timer, User,
} from 'lucide-react';
import { api } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';
import { useVoiceInterview } from '@/src/hooks/useVoiceInterview';

interface BriefSection { topic: string; title: string; detail: string }
interface SessionData {
  startedAt: string;
  config: { interviewerStyle: string; durationMinutes: number };
  caseId: {
    resumeRole?: string;
    resumeTopics?: string[];
    resumeBrief?: { candidateName?: string; headline?: string; sections?: BriefSection[] };
  };
}

type MobileTab = 'interview' | 'resume' | 'transcript';

const TOPIC_LABEL: Record<string, string> = {
  work: 'Work', internship: 'Internship', project: 'Project', leadership: 'Leadership', education: 'Education',
};

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// The interviewer often reacts to your last answer THEN asks; the stage shows only the ask.
function askOnly(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const sentences = t.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [t];
  const questions = sentences.filter((s) => s.endsWith('?'));
  return (questions.length ? questions[questions.length - 1] : sentences[sentences.length - 1]).trim();
}

export default function ResumeSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const voice = useVoiceInterview(sessionId, '/api/resume-interviews/voice');
  const { status, error, transcript, liveText, liveRole, aiSpeaking, micMuted } = voice;

  const [data, setData] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [ending, setEnding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileTab, setMobileTab] = useState<MobileTab>('interview');
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true));
  const [elapsed, setElapsed] = useState(0);

  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api.get<{ session: SessionData }>(`/resume-interviews/${sessionId}`)
      .then((d) => { if (!cancelled) setData(d.session); })
      .catch(() => { if (!cancelled) setLoadError('Could not load this interview. Go back and start again.'); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Elapsed clock runs only while the interview is live.
  useEffect(() => {
    if (status !== 'ready') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [transcript, liveText]);

  const brief = data?.caseId?.resumeBrief;
  const role = data?.caseId?.resumeRole ?? 'Resume interview';
  const topics = data?.caseId?.resumeTopics ?? [];
  const targetMin = data?.config?.durationMinutes ?? 25;
  const overtime = elapsed > targetMin * 60;

  const lastInterviewer = [...transcript].reverse().find((e) => e.role === 'interviewer');
  const liveInterviewer = liveRole === 'interviewer' ? liveText : '';
  const question = askOnly(liveInterviewer || lastInterviewer?.text || '')
    || (status === 'ready' ? 'Your interviewer will begin shortly…' : status === 'connecting' ? 'Connecting to your interviewer…' : '');
  const candidateLive = liveRole === 'candidate' ? liveText : '';
  const candidateTurns = transcript.filter((e) => e.role === 'candidate').length;

  const stage = (() => {
    if (status === 'connecting') return { dot: 'bg-on-tertiary-container animate-pulse', text: 'Connecting…' };
    if (status === 'error') return { dot: 'bg-error', text: 'Connection error' };
    if (status === 'ended') return { dot: 'bg-secondary', text: 'Interview ended' };
    if (aiSpeaking) return { dot: 'bg-on-tertiary-container animate-pulse', text: 'Interviewer is speaking…' };
    if (candidateLive) return { dot: 'bg-primary animate-pulse', text: 'Listening to you…' };
    return { dot: 'bg-on-tertiary-container', text: micMuted ? 'You are muted' : 'Your turn. Speak when ready.' };
  })();

  const finish = async () => {
    if (ending) return;
    setEnding(true);
    voice.disconnect();
    try { await api.patch(`/resume-interviews/${sessionId}/end`, {}); } catch { /* already ended server-side */ }
    // A report needs at least one answer to score.
    navigate(candidateTurns > 0 ? `/report/resume/${sessionId}` : '/interview/resume', { replace: true });
  };

  const q = search.trim().toLowerCase();
  const visible = transcript.filter((e) => !q || e.text.toLowerCase().includes(q));

  /* ── Panels ─────────────────────────────────────────────── */
  const stagePanel = (
    <section className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden lg:flex-[44_1_0%]">
      <div className="flex-grow min-h-0 overflow-y-auto scrolling-log p-5 flex flex-col items-center text-center">
        {/* Interviewer orb */}
        <div className="relative mt-4 w-28 h-28 shrink-0 flex items-center justify-center" aria-hidden="true">
          {aiSpeaking && <span className="absolute inset-0 rounded-full bg-on-tertiary-container/20 animate-ping" />}
          <span className={cn(
            'absolute inset-2 rounded-full transition-all duration-300',
            aiSpeaking ? 'bg-on-tertiary-container/25 scale-110' : candidateLive ? 'bg-primary/15 scale-105' : 'bg-on-tertiary-container/10',
          )} />
          <span className="relative w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <User className="w-7 h-7" />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full', stage.dot)} />
          <span className="label-blueprint">{stage.text}</span>
        </div>

        <div className="mt-6 w-full text-left bg-surface-container-low rounded-lg p-4 border-l-4 border-on-tertiary-container">
          <div className="label-blueprint mb-1">Current question</div>
          <p className="text-[15px] text-primary font-medium leading-relaxed" aria-live="polite">{question}</p>
        </div>

        {candidateLive && (
          <div className="mt-3 w-full text-left rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-4">
            <div className="label-blueprint mb-1 text-secondary">You are saying</div>
            <p className="text-sm text-on-surface-variant italic leading-relaxed">
              {candidateLive}
              <span className="inline-block w-1 h-3 bg-on-tertiary-container ml-0.5 animate-pulse align-middle" />
            </p>
          </div>
        )}

        <p className="mt-auto pt-6 text-[11px] text-secondary max-w-sm">
          Answer out loud, like a real panel. Give the headline first, say what <em>you</em> did, and land on a number.
        </p>
      </div>
    </section>
  );

  const resumePanel = (
    <section className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden lg:flex-[28_1_0%]">
      <header className="px-4 py-3 border-b border-outline-variant/15 shrink-0 flex items-center gap-2">
        <FileText className="w-4 h-4 text-on-tertiary-container" />
        <span className="label-blueprint">Your resume</span>
      </header>
      <div className="overflow-y-auto scrolling-log p-4 space-y-4">
        {!data ? (
          <div className="flex items-center gap-2 text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : (
          <>
            {brief?.headline && <p className="text-sm text-primary font-medium leading-relaxed">{brief.headline}</p>}
            {topics.length > 0 && (
              <div>
                <div className="label-blueprint mb-1.5">Focus topics</div>
                <div className="flex flex-wrap gap-1.5">
                  {topics.map((t) => (
                    <span key={t} className="text-[11px] font-semibold px-2 py-0.5 rounded bg-on-tertiary-container/10 text-on-tertiary-container">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="label-blueprint mb-2">What the interviewer read</div>
              <ul className="space-y-2">
                {(brief?.sections ?? []).map((s, i) => (
                  <li key={i} className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-secondary">{TOPIC_LABEL[s.topic] ?? s.topic}</div>
                    <div className="text-[13px] font-semibold text-primary leading-snug">{s.title}</div>
                    {s.detail && <div className="text-[12px] text-secondary leading-snug">{s.detail}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );

  const transcriptPanel = (
    <section className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden lg:flex-[28_1_0%]">
      <header className="px-4 py-3 border-b border-outline-variant/15 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-on-tertiary-container" />
          <span className="label-blueprint">Live transcript</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcript"
            aria-label="Search transcript"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-surface-container-low border border-outline-variant/15 focus:outline-none focus:border-on-tertiary-container/50 text-on-surface placeholder:text-secondary"
          />
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="overflow-y-auto scrolling-log flex-grow p-4 space-y-4"
      >
        {transcript.length === 0 && !liveText && (
          <p className="text-xs text-secondary italic">{status === 'connecting' ? 'Waiting for the interview to start…' : 'The conversation will appear here.'}</p>
        )}
        {q && visible.length === 0 && <p className="text-xs text-secondary italic">No messages match “{search}”.</p>}
        {visible.map((e, i) => (
          <div key={i} className="space-y-1">
            <span className={cn('text-[10px] font-bold', e.role === 'interviewer' ? 'text-on-tertiary-container' : 'text-primary')}>
              {e.role === 'interviewer' ? 'INTERVIEWER' : 'YOU'}
            </span>
            <div className={cn(
              'p-3.5 rounded-lg text-sm leading-relaxed',
              e.role === 'interviewer'
                ? 'bg-surface-container-low text-on-surface-variant italic'
                : 'bg-surface-container-lowest text-primary border border-outline-variant/10',
            )}>{e.text}</div>
          </div>
        ))}
        {liveText && !q && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-secondary">{liveRole === 'candidate' ? 'YOU' : 'INTERVIEWER'} · transcribing…</span>
            <div className="bg-surface-container-low p-3.5 rounded-lg text-sm text-on-surface-variant italic leading-relaxed">{liveText}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );

  return (
    <div className="h-[calc(100vh-5rem)] flex flex-col gap-3 py-3">
      {/* Top strip */}
      <div className="flex items-center justify-between gap-4 px-1 shrink-0">
        <div className="min-w-0">
          <div className="label-blueprint">Resume interview · {data?.config?.interviewerStyle ?? '…'}</div>
          <h1 className="font-headline font-extrabold text-primary text-base lg:text-lg truncate">{role}</h1>
        </div>
        <div
          className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full shrink-0', overtime ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-primary')}
          role="timer"
          aria-label="Elapsed time"
        >
          <Timer className="w-4 h-4" />
          <span className="font-headline font-bold text-sm tabular-nums">{fmt(elapsed)}</span>
          <span className="text-xs opacity-70">/ {targetMin} min</span>
        </div>
      </div>

      {(status === 'error' || loadError) && (
        <div role="alert" className="shrink-0 flex items-center gap-2 text-red-600 bg-error-container/50 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium">
            {loadError || error || 'Voice connection error'}
            {candidateTurns > 0 ? ' You can still get your report.' : ''}
          </span>
        </div>
      )}
      {status === 'ended' && (
        <div role="status" className="shrink-0 flex items-center justify-between gap-3 bg-tertiary-fixed/60 text-on-tertiary-fixed-variant rounded-lg px-4 py-2">
          <span className="text-sm font-medium">The interview has ended.</span>
          <button onClick={finish} disabled={ending} className="text-sm font-bold underline disabled:opacity-60">
            {candidateTurns > 0 ? 'Get my report' : 'Back to setup'}
          </button>
        </div>
      )}

      {!isDesktop && (
        <div className="flex gap-1 bg-surface-container rounded-lg p-1 shrink-0">
          {([['interview', 'Interview'], ['resume', 'Resume'], ['transcript', 'Transcript']] as [MobileTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={cn('flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition', mobileTab === key ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-secondary')}
            >{label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 flex-grow min-h-0">
        {(isDesktop || mobileTab === 'resume') && resumePanel}
        {(isDesktop || mobileTab === 'interview') && stagePanel}
        {(isDesktop || mobileTab === 'transcript') && transcriptPanel}
      </div>

      {/* Action bar */}
      <div className="shrink-0 no-line-card flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={voice.toggleMute}
            disabled={status !== 'ready'}
            aria-pressed={micMuted}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={cn(
              'w-11 h-11 rounded-full transition-all flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
              micMuted ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-primary hover:bg-surface-container',
            )}
          >
            {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('w-2 h-2 rounded-full shrink-0', stage.dot)} />
            <span className="label-blueprint truncate">{stage.text}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {confirmLeave ? (
            <>
              <span className="hidden sm:inline text-xs text-secondary">
                {candidateTurns > 0 ? 'End now and score what you said?' : 'Leave without a report?'}
              </span>
              <button onClick={() => setConfirmLeave(false)} className="px-3 py-2 text-sm font-semibold text-secondary hover:text-primary">Keep going</button>
              <button
                onClick={finish}
                disabled={ending}
                className="px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {ending && <Loader2 className="w-4 h-4 animate-spin" />}
                {candidateTurns > 0 ? 'End & get report' : 'Leave'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmLeave(true)}
              className="px-5 py-2.5 rounded-lg bg-error-container text-on-error-container font-headline font-bold text-sm flex items-center gap-2 hover:bg-error/10 transition"
            >
              <PhoneOff className="w-4 h-4" /> End interview
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
