import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  MicOff, Mic, PhoneOff, Lightbulb, AlertCircle, Loader2,
  FileText, NotebookPen, MessageSquare, Search, ArrowDown,
  Bookmark, HelpCircle, Eraser, ListTree,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getWsUrl } from '@/src/lib/api';
import { ExhibitCard } from '@/src/components/ExhibitCard';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TranscriptEntry {
  role: 'interviewer' | 'candidate';
  text: string;
}

interface KeyDataPoint {
  label: string;
  value: string;
}

interface SessionData {
  caseId: {
    title: string;
    scenario: string;
    keyDataPoints: KeyDataPoint[];
  };
  config: {
    difficulty: number;
    interviewerStyle: string;
    caseType?: string;
  };
}

type WsStatus = 'connecting' | 'ready' | 'ended' | 'error';
type FocusMode = 'balanced' | 'case' | 'analysis' | 'transcript';
type MobileTab = 'case' | 'workspace' | 'transcript';

const STAGES = ['Case Understanding', 'Structuring', 'Analysis', 'Recommendation'];

const FOCUS_MODES: { key: FocusMode; label: string }[] = [
  { key: 'balanced', label: 'Balanced' },
  { key: 'case', label: 'Case' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'transcript', label: 'Transcript' },
];

// flex-grow ratios per focus mode (flex-basis 0 → proportional widths)
const FLEX: Record<FocusMode, { case: number; workspace: number; transcript: number }> = {
  balanced: { case: 30, workspace: 40, transcript: 30 },
  case: { case: 52, workspace: 26, transcript: 22 },
  analysis: { case: 22, workspace: 56, transcript: 22 },
  transcript: { case: 22, workspace: 26, transcript: 52 },
};

const SCRATCHPAD_TEMPLATE = `Recommendation hypothesis:
-

Structure (issue tree):
1.
2.
3.

Key assumptions:
-

Calculations:
-
`;

export default function Session() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveText, setLiveText] = useState('');
  // Whose partial transcript `liveText` holds. Realtime streams the interviewer;
  // the PM pipeline streams the candidate — so the live bubble + "current
  // question" must follow the role, not assume it's the AI.
  const [liveRole, setLiveRole] = useState<'interviewer' | 'candidate'>('interviewer');
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [wsError, setWsError] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Exhibits the interviewer has revealed (pharma cases) — accumulate in the brief.
  const [exhibits, setExhibits] = useState<any[]>([]);
  // A freshly-revealed exhibit is spotlighted center-screen for a few seconds,
  // then docks into the brief on the left (recentId briefly highlights it there).
  const [spotlight, setSpotlight] = useState<any | null>(null);
  const [recentId, setRecentId] = useState<any>(null);

  // Workspace / layout state
  const [scratchpad, setScratchpad] = useState('');
  const [focusMode, setFocusMode] = useState<FocusMode>('balanced');
  const [mobileTab, setMobileTab] = useState<MobileTab>('workspace');
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [latestHint, setLatestHint] = useState('');
  const [hintCount, setHintCount] = useState(0);
  const [hintLoading, setHintLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  // Scheduled-but-not-yet-finished AI audio chunks, so we can cut them off
  // instantly when the candidate starts speaking (barge-in).
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const micMutedRef = useRef(false);

  // Track viewport so we can render one panel at a time on mobile (independent
  // mounting) instead of compressing three columns into narrow strips.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Load scratchpad notes for this session from localStorage
  useEffect(() => {
    if (!sessionId) return;
    const saved = localStorage.getItem(`scratchpad_${sessionId}`);
    if (saved) setScratchpad(saved);
  }, [sessionId]);

  // Spotlight an exhibit for a few seconds, then let it dock into the brief.
  useEffect(() => {
    if (!spotlight) return;
    const t = setTimeout(() => setSpotlight(null), 6000);
    return () => clearTimeout(t);
  }, [spotlight]);
  // Fade the "just docked" highlight on the left card.
  useEffect(() => {
    if (recentId == null) return;
    const t = setTimeout(() => setRecentId(null), 2500);
    return () => clearTimeout(t);
  }, [recentId]);

  const updateScratchpad = useCallback((value: string) => {
    setScratchpad(value);
    if (sessionId) localStorage.setItem(`scratchpad_${sessionId}`, value);
  }, [sessionId]);

  // Auto-scroll transcript to bottom on new content — unless the candidate has
  // scrolled up to revisit an earlier answer.
  useEffect(() => {
    // Instant (not smooth): partial transcripts stream many deltas/sec and
    // stacked smooth-scroll animations cause visible lag during a turn.
    if (autoScrollRef.current) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [transcript, liveText]);

  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    autoScrollRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    autoScrollRef.current = true;
    setShowJumpToLatest(false);
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const playPcm16Chunk = useCallback((base64: string) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    try {
      const raw = atob(base64);
      // Drop a lone trailing byte if the chunk is odd-length — Int16Array requires
      // an even byte count or it throws (silently dropping the whole chunk).
      const usable = raw.length - (raw.length % 2);
      if (usable <= 0) return;
      const bytes = new Uint8Array(usable);
      for (let i = 0; i < usable; i++) bytes[i] = raw.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, ctx.currentTime);
      src.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
      setIsAiSpeaking(true);
      activeSourcesRef.current.push(src);
      src.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
        if (nextPlayTimeRef.current <= ctx.currentTime + 0.05) {
          setIsAiSpeaking(false);
        }
      };
    } catch {
      // ignore decode errors
    }
  }, []);

  // Stop all queued AI audio at once — used for barge-in when the candidate
  // starts speaking so the AI doesn't keep talking over them.
  const flushPlayback = useCallback(() => {
    const ctx = playbackCtxRef.current;
    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = ctx ? ctx.currentTime : 0;
    setIsAiSpeaking(false);
  }, []);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    captureCtxRef.current?.close();
    captureCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const startMicCapture = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;

    navigator.mediaDevices.getUserMedia({
      // Let the browser DSP clean the mic before it ever reaches the VAD:
      // echoCancellation stops the AI's own voice (from the speakers) being
      // heard as the candidate talking, noiseSuppression strips background hum,
      // autoGainControl levels the volume. Without these, bare `audio: true`
      // sends raw mic and the server VAD misfires on every little sound.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then((stream: MediaStream) => {
      micStreamRef.current = stream;
      // Must match the input rate the server declares to OpenAI (24kHz). A
      // mismatch makes the candidate's speech sound sped-up/garbled to the
      // model, so it can't understand them and its VAD misfires.
      const captureCtx = new AudioContext({ sampleRate: 24000 });
      captureCtxRef.current = captureCtx;
      const source = captureCtx.createMediaStreamSource(stream);
      // Smaller buffer = lower capture latency (~85ms at 24kHz).
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = captureCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(captureCtx.destination);

      // The first audio frame means mic + capture context are truly live; tell
      // the server so it fires the AI's opening ("can you hear me?") into a live
      // pipeline instead of clipping it at 00:00. Sent once, before the mute
      // check (pipeline being up is independent of whether the mic is muted).
      let liveSent = false;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!liveSent) {
          liveSent = true;
          ws.send(JSON.stringify({ type: 'audio_live' }));
        }
        if (micMutedRef.current) return;
        // Mic stays open while the AI speaks so the candidate can barge in. Users
        // are on headphones, so there's no speaker echo to false-trigger the VAD.
        // On real barge-in, speech_started → flushPlayback cuts the AI audio and
        // interrupt_response (server) cancels the AI turn.
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 32768 : s * 32767;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        ws.send(JSON.stringify({ type: 'audio_chunk', data: base64 }));
      };
    }).catch((err: Error) => {
      setWsError(`Microphone access denied: ${err.message}. Please allow mic access and refresh.`);
    });
  }, []);

  // Load session data + connect WebSocket
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    api.get<{ session: SessionData }>(`/sessions/${sessionId}`)
      .then((data) => {
        if (!cancelled) setSessionData(data.session);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load session data.');
      });

    const wsUrl = getWsUrl('/api/voice', { sessionId: sessionId! });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case 'session_ready':
            setWsStatus('ready');
            startMicCapture();
            break;
          case 'audio_chunk':
            playPcm16Chunk(msg.data as string);
            break;
          case 'speech_started':
            // Candidate started talking — cut off any buffered AI audio.
            flushPlayback();
            break;
          case 'exhibit': {
            // Interviewer revealed an exhibit — spotlight it, then dock to the brief.
            const ex = (msg as any).exhibit;
            console.log('[exhibit] received frame', ex); // TEMP DIAGNOSTIC
            if (!ex) break;
            setExhibits((prev) => (prev.some((p) => p.id != null && p.id === ex.id) ? prev : [...prev, ex]));
            setSpotlight(ex);
            setRecentId(ex.id ?? null);
            break;
          }
          case 'transcript_delta':
            setLiveRole((msg.role as 'interviewer' | 'candidate') || 'interviewer');
            setLiveText((prev) => prev + (msg.text as string));
            break;
          case 'transcript':
            setTranscript((prev) => [...prev, { role: msg.role as 'interviewer' | 'candidate', text: msg.text as string }]);
            setLiveText('');
            break;
          case 'session_ended':
            setWsStatus('ended');
            setIsAiSpeaking(false);
            break;
          case 'error':
            setWsStatus('error');
            setIsAiSpeaking(false);
            setWsError((msg.message as string) || 'Voice service error');
            break;
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      // onclose will fire right after with code/reason — don't override status here
    };
    ws.onclose = (event) => {
      if (!cancelled) {
        const isClean = event.code === 1000 || event.code === 1001;
        if (isClean) {
          setWsStatus((s) => s === 'ready' ? 'ended' : s);
        } else {
          setWsStatus('error');
          // Prefer the reason string from the server; fall back to the code
          // Don't overwrite a specific error message already set by an 'error' WS event
          setWsError((prev) => prev || event.reason || `Connection closed (code ${event.code})`);
        }
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      stopMic();
      playbackCtxRef.current?.close();
      playbackCtxRef.current = null;
    };
  }, [sessionId, playPcm16Chunk, startMicCapture, stopMic, flushPlayback]);

  const handleStopAndSubmit = async () => {
    setSubmitting(true);
    wsRef.current?.send(JSON.stringify({ type: 'end_session' }));
    wsRef.current?.close();
    stopMic();
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    try {
      await api.patch(`/sessions/${sessionId}/end`, { scratchpad });
    } catch {
      // ignore — navigate anyway
    }
    navigate(`/report/${sessionId}`);
  };

  const handleHint = async () => {
    setHintLoading(true);
    try {
      const data = await api.get<{ hint: string }>(`/sessions/${sessionId}/hint`);
      setLatestHint(data.hint);
      setHintCount((c) => c + 1);
      setTranscript((prev) => [...prev, { role: 'interviewer', text: `[HINT] ${data.hint}` }]);
    } catch {
      setLatestHint('Could not retrieve a hint right now. Please try again.');
    } finally {
      setHintLoading(false);
    }
  };

  const toggleBookmark = (i: number) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const toggleExpand = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const caseDoc = sessionData?.caseId;
  // Product & guesstimate are free-flowing — the consulting stage arc doesn't apply.
  const ct = sessionData?.config?.caseType;
  const moduleKind: 'case' | 'product' | 'guesstimate' =
    ct?.startsWith('product') ? 'product' : ct === 'guesstimate' ? 'guesstimate' : 'case';

  // Derived: the current question = the interviewer's live turn (if it's the AI
  // streaming), else its last spoken turn. Never the candidate's own partial.
  const lastInterviewer = [...transcript].reverse()
    .find((e) => e.role === 'interviewer' && !e.text.startsWith('[HINT]'));
  const liveQuestion = liveRole === 'interviewer' ? liveText : '';
  // Show ONLY the question being asked — the PM interviewer's turn often reacts to
  // your last answer THEN asks; strip the reaction and keep the actual ask.
  const askOnly = (text: string): string => {
    const t = text.trim();
    if (!t) return t;
    const sentences = t.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [t];
    const questions = sentences.filter((s) => s.endsWith('?'));
    return (questions.length ? questions[questions.length - 1] : sentences[sentences.length - 1]).trim();
  };
  const currentQuestion = askOnly(liveQuestion || lastInterviewer?.text || '')
    || (wsStatus === 'ready' ? 'The interviewer will begin shortly…' : 'Connecting to your interviewer…');

  // Derived: rough progress stage from how many turns the candidate has taken.
  const candidateTurns = transcript.filter((e) => e.role === 'candidate').length;
  const stageIndex = candidateTurns <= 1 ? 0 : candidateTurns <= 3 ? 1 : candidateTurns <= 6 ? 2 : 3;

  const search = transcriptSearch.trim().toLowerCase();
  const visibleEntries = transcript
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => !search || entry.text.toLowerCase().includes(search));

  const flex = FLEX[focusMode];
  const panelStyle = (key: keyof typeof flex): React.CSSProperties | undefined =>
    isDesktop ? { flex: `${flex[key]} 1 0%` } : undefined;

  const statusPill = (() => {
    if (wsStatus === 'connecting') return { dot: 'bg-on-tertiary-container animate-pulse', text: 'Connecting…' };
    if (wsStatus === 'ended') return { dot: 'bg-secondary', text: 'Session ended' };
    if (wsStatus === 'error') return { dot: 'bg-error', text: 'Connection error' };
    return isAiSpeaking
      ? { dot: 'bg-on-tertiary-container animate-pulse', text: 'AI is speaking…' }
      : { dot: 'bg-on-tertiary-container', text: 'AI is listening…' };
  })();

  // ── Panels ──────────────────────────────────────────────────────────────
  const caseBriefPanel = (
    <section style={panelStyle('case')} className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden">
      <header className="px-5 py-3 border-b border-outline-variant/15 shrink-0 flex items-center gap-2">
        <FileText className="w-4 h-4 text-on-tertiary-container" />
        <span className="label-blueprint">Case Brief</span>
      </header>
      <div className="overflow-y-auto scrolling-log p-5 space-y-6">
        {caseDoc ? (
          <>
            <div>
              <h2 className="font-headline font-bold text-lg text-primary mb-2">{caseDoc.title}</h2>
              <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{caseDoc.scenario}</p>
            </div>
            {caseDoc.keyDataPoints.length > 0 && (
              <div>
                <label className="label-blueprint mb-3 block">Key Data &amp; Exhibits</label>
                <div className="space-y-3">
                  {caseDoc.keyDataPoints.map((item, i) => (
                    <div key={i} className="flex justify-between items-end gap-4 border-b border-outline-variant/15 pb-2">
                      <span className="text-xs text-on-surface-variant">{item.label}</span>
                      <span className="font-headline font-bold text-primary text-right shrink-0">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exhibits revealed by the interviewer accumulate here as they're earned. */}
            {exhibits.length > 0 && (
              <div>
                <label className="label-blueprint mb-3 block">Exhibits</label>
                <div className="space-y-3">
                  {exhibits.map((ex, i) => (
                    <div key={ex.id ?? i} className={cn('rounded-lg transition-all duration-500', ex.id != null && ex.id === recentId && 'ring-2 ring-on-tertiary-container ring-offset-2 ring-offset-surface')}>
                      <ExhibitCard ex={ex} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {caseDoc.keyDataPoints.length === 0 && exhibits.length === 0 && (
              <div className="rounded-lg bg-surface-container-low p-4 border border-outline-variant/15">
                <label className="label-blueprint mb-1.5 block">Exhibits &amp; data</label>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Like a real interview, the data isn&apos;t laid out for you. Your interviewer holds the
                  exhibits and will share figures as your analysis earns them — structure your approach,
                  then <span className="text-primary font-medium">ask for the numbers you need</span>.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading case…</span>
          </div>
        )}
      </div>
    </section>
  );

  const workspacePanel = (
    <section style={panelStyle('workspace')} className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden">
      <header className="px-5 py-3 border-b border-outline-variant/15 shrink-0 flex items-center gap-2">
        <NotebookPen className="w-4 h-4 text-on-tertiary-container" />
        <span className="label-blueprint">Workspace</span>
      </header>
      <div className="flex flex-col min-h-0 flex-grow p-5 gap-4">
        {/* Current question + contextual hints */}
        <div className="shrink-0 bg-surface-container-low rounded-lg p-4 border-l-4 border-on-tertiary-container">
          <div className="label-blueprint mb-1">{moduleKind === 'case' ? 'Current Question' : 'Latest from interviewer'}</div>
          {/* Clamp + scroll so a long interviewer turn can't overflow and shove the
              scratchpad off-screen. */}
          <p className="text-sm text-primary font-medium leading-relaxed max-h-28 overflow-y-auto scrolling-log pr-1">{currentQuestion}</p>
          <div className="flex items-center flex-wrap gap-2 mt-3">
            <span className="text-[11px] text-secondary">Need help?</span>
            <button
              onClick={handleHint}
              disabled={wsStatus !== 'ready' || hintLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high text-primary text-[11px] font-medium hover:bg-surface-container transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {hintLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
              Request a hint
            </button>
            {hintCount > 0 && (
              <span className="text-[10px] text-secondary">{hintCount} hint{hintCount > 1 ? 's' : ''} used</span>
            )}
          </div>
          {latestHint && (
            <div className="mt-3 flex gap-2 text-xs text-on-surface-variant bg-surface-container-lowest rounded-md p-3 border border-outline-variant/15">
              <HelpCircle className="w-3.5 h-3.5 text-on-tertiary-container shrink-0 mt-0.5" />
              <span className="leading-relaxed">{latestHint}</span>
            </div>
          )}
        </div>

        {/* Scratchpad */}
        <div className="flex flex-col min-h-0 flex-grow">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="label-blueprint">Scratchpad</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateScratchpad(scratchpad ? scratchpad + '\n' + SCRATCHPAD_TEMPLATE : SCRATCHPAD_TEMPLATE)}
                className="flex items-center gap-1 text-[11px] text-secondary hover:text-primary transition"
              >
                <ListTree className="w-3 h-3" /> Structure
              </button>
              <button
                onClick={() => updateScratchpad('')}
                className="flex items-center gap-1 text-[11px] text-secondary hover:text-primary transition"
              >
                <Eraser className="w-3 h-3" /> Clear
              </button>
            </div>
          </div>
          <textarea
            value={scratchpad}
            onChange={(e) => updateScratchpad(e.target.value)}
            placeholder={'Structure your thinking here…\n\n• Assumptions\n• Calculations\n• Issue tree\n• Final recommendation'}
            spellCheck={false}
            className="w-full flex-grow min-h-[180px] resize-none rounded-lg bg-surface-container-lowest border border-outline-variant/20 p-4 text-sm text-on-surface font-body leading-relaxed focus:outline-none focus:border-on-tertiary-container/50 scrolling-log"
          />
          <p className="text-[10px] text-secondary mt-1.5 shrink-0">
            Private to you — the interviewer doesn&apos;t see your notes. Saved automatically.
          </p>
        </div>
      </div>
    </section>
  );

  const transcriptPanel = (
    <section style={panelStyle('transcript')} className="no-line-card flex flex-col min-h-0 flex-grow overflow-hidden relative">
      <header className="px-4 py-3 border-b border-outline-variant/15 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-on-tertiary-container" />
          <span className="label-blueprint">Live Transcript</span>
          {wsStatus === 'ready' && (
            <span className="relative flex h-2 w-2 ml-auto">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-on-tertiary-container opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-on-tertiary-container" />
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary" />
          <input
            value={transcriptSearch}
            onChange={(e) => setTranscriptSearch(e.target.value)}
            placeholder="Search transcript"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-surface-container-low border border-outline-variant/15 focus:outline-none focus:border-on-tertiary-container/50 text-on-surface placeholder:text-secondary"
          />
        </div>
      </header>

      <div
        ref={transcriptScrollRef}
        onScroll={handleTranscriptScroll}
        className="overflow-y-auto scrolling-log flex-grow p-4 space-y-5"
      >
        {transcript.length === 0 && wsStatus === 'connecting' && (
          <p className="text-xs text-secondary italic">Waiting for session to start…</p>
        )}
        {visibleEntries.length === 0 && search && (
          <p className="text-xs text-secondary italic">No messages match “{transcriptSearch}”.</p>
        )}

        {visibleEntries.map(({ entry, i }) => {
          const isHint = entry.text.startsWith('[HINT]');
          const isLong = entry.text.length > 320;
          const isOpen = expanded.has(i);
          const shown = isLong && !isOpen ? entry.text.slice(0, 320).trimEnd() + '…' : entry.text;
          const bookmarked = bookmarks.has(i);
          return (
            <div key={i} className="space-y-1 group">
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-[10px] font-bold",
                  entry.role === 'interviewer' ? "text-on-tertiary-container" : "text-primary"
                )}>
                  {isHint ? 'HINT' : entry.role === 'interviewer' ? 'PARTNER (AI)' : 'CANDIDATE (YOU)'}
                </span>
                <button
                  onClick={() => toggleBookmark(i)}
                  title={bookmarked ? 'Remove bookmark' : 'Bookmark this'}
                  className={cn(
                    "transition",
                    bookmarked ? "text-on-tertiary-container" : "text-secondary/40 opacity-0 group-hover:opacity-100 hover:text-secondary"
                  )}
                >
                  <Bookmark className="w-3.5 h-3.5" fill={bookmarked ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className={cn(
                "p-4 rounded-lg text-sm leading-relaxed",
                isHint
                  ? "bg-tertiary-fixed/40 text-on-tertiary-fixed-variant border border-on-tertiary-container/20"
                  : entry.role === 'interviewer'
                    ? "bg-surface-container-low text-on-surface-variant italic"
                    : "bg-surface-container-lowest text-primary border border-outline-variant/10",
                bookmarked && "ring-1 ring-on-tertiary-container/40"
              )}>
                {shown}
                {isLong && (
                  <button
                    onClick={() => toggleExpand(i)}
                    className="block mt-1.5 text-[11px] font-medium text-on-tertiary-container hover:underline"
                  >
                    {isOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Live (in-progress) AI turn with a transcribing indicator attached */}
        {liveText && !search && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-on-tertiary-container">{liveRole === 'candidate' ? 'YOU' : 'PARTNER (AI)'}</span>
              <span className="flex items-center gap-1 text-[10px] text-secondary italic">
                <span className="flex gap-0.5">
                  <span className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse" />
                  <span className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse delay-75" />
                  <span className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse delay-150" />
                </span>
                transcribing…
              </span>
            </div>
            <div className="bg-surface-container-low p-4 rounded-lg text-sm text-on-surface-variant leading-relaxed italic">
              {liveText}
              <span className="inline-block w-1 h-3 bg-on-tertiary-container ml-0.5 animate-pulse" />
            </div>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-medium shadow-lg hover:scale-105 transition"
        >
          <ArrowDown className="w-3.5 h-3.5" /> Jump to latest
        </button>
      )}
    </section>
  );

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col gap-3 py-3">
      {/* Top strip: case title · progress · focus modes */}
      <div className="flex items-center justify-between gap-4 px-1 shrink-0">
        <div className="min-w-0">
          <div className="label-blueprint">Case Interview</div>
          <h1 className="font-headline font-extrabold text-primary text-base lg:text-lg truncate">
            {caseDoc?.title ?? 'Preparing your session…'}
          </h1>
        </div>

        {/* Progress indicator — consulting only; product & guesstimate are free-flowing */}
        {moduleKind === 'case' ? (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {STAGES.map((s, i) => (
              <React.Fragment key={s}>
                <div className={cn(
                  "flex items-center gap-1.5",
                  i <= stageIndex ? "text-on-tertiary-container" : "text-secondary/40"
                )}>
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    i < stageIndex ? "bg-on-tertiary-container"
                      : i === stageIndex ? "bg-on-tertiary-container animate-pulse"
                        : "bg-outline-variant"
                  )} />
                  <span className="text-[11px] font-medium whitespace-nowrap">{s}</span>
                </div>
                {i < STAGES.length - 1 && <div className="w-5 h-px bg-outline-variant/50" />}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1.5 shrink-0 text-secondary">
            <span className="w-2 h-2 rounded-full bg-on-tertiary-container animate-pulse" />
            <span className="text-[11px] font-medium">{moduleKind === 'guesstimate' ? 'Guesstimate' : 'Product'} · free-flowing</span>
          </div>
        )}

        {/* Focus modes (desktop) */}
        <div className="hidden lg:flex items-center gap-1 bg-surface-container rounded-lg p-1 shrink-0">
          {FOCUS_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setFocusMode(m.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition",
                focusMode === m.key ? "bg-surface-container-lowest text-primary shadow-sm" : "text-secondary hover:text-primary"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {wsStatus === 'error' && (
        <div className="shrink-0 flex items-center gap-2 text-red-600 bg-error-container/50 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm font-medium">{wsError || 'Voice connection error'}. You can still submit.</span>
        </div>
      )}

      {/* Mobile panel tabs */}
      {!isDesktop && (
        <div className="flex gap-1 bg-surface-container rounded-lg p-1 shrink-0">
          {([['case', 'Case'], ['workspace', 'Workspace'], ['transcript', 'Transcript']] as [MobileTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition",
                mobileTab === key ? "bg-surface-container-lowest text-primary shadow-sm" : "text-secondary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Three-panel workspace — each panel scrolls independently */}
      <div className="flex flex-col lg:flex-row gap-3 flex-grow min-h-0">
        {(isDesktop || mobileTab === 'case') && caseBriefPanel}
        {(isDesktop || mobileTab === 'workspace') && workspacePanel}
        {(isDesktop || mobileTab === 'transcript') && transcriptPanel}
      </div>

      {/* Action bar */}
      <div className="shrink-0 no-line-card flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setMicMuted((m) => { micMutedRef.current = !m; return !m; })}
            disabled={wsStatus !== 'ready'}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={cn(
              "w-11 h-11 rounded-full transition-all flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
              micMuted ? "bg-error-container text-on-error-container" : "bg-surface-container-high text-primary hover:bg-surface-container"
            )}
          >
            {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("w-2 h-2 rounded-full shrink-0", statusPill.dot)} />
            <span className="label-blueprint truncate">{statusPill.text}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleStopAndSubmit}
            disabled={submitting}
            className="px-6 py-3 bg-primary text-on-primary font-headline font-bold rounded-lg shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Stop &amp; Submit
          </button>
          <button
            onClick={() => {
              wsRef.current?.close();
              stopMic();
              navigate('/dashboard');
            }}
            title="Leave without submitting"
            className="w-11 h-11 rounded-full bg-error-container text-on-error-container hover:bg-error/10 transition-all flex items-center justify-center shrink-0"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="shrink-0 text-center text-red-500 text-sm">{loadError}</div>
      )}

      {/* Exhibit spotlight — center-screen for a few seconds, then docks to the brief */}
      {spotlight && (
        <div
          onClick={() => setSpotlight(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-primary/40 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-[min(640px,94vw)] max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="label-blueprint text-on-tertiary-container">New exhibit</span>
              <button onClick={() => setSpotlight(null)} className="text-xs font-semibold text-secondary hover:text-primary">Dismiss</button>
            </div>
            <ExhibitCard ex={spotlight} large />
            <p className="text-[11px] text-secondary mt-4 text-center flex items-center justify-center gap-1.5">
              <ArrowDown className="w-3 h-3" /> Docking to your Case Brief on the left…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
