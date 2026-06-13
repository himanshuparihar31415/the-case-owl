import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MicOff, Mic, PhoneOff, Lightbulb, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { api, getWsUrl } from '@/src/lib/api';

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
  };
}

type WsStatus = 'connecting' | 'ready' | 'ended' | 'error';


export default function Session() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveText, setLiveText] = useState('');
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [wsError, setWsError] = useState('');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
  const micMutedRef = useRef(false);

  // Scroll transcript to bottom on new messages
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, liveText]);

  const playPcm16Chunk = useCallback((base64: string) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    try {
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
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

    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream: MediaStream) => {
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

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN || micMutedRef.current) return;
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
          case 'transcript_delta':
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
      await api.patch(`/sessions/${sessionId}/end`);
    } catch {
      // ignore — navigate anyway
    }
    navigate(`/report/${sessionId}`);
  };

  const handleHint = async () => {
    try {
      const data = await api.get<{ hint: string }>(`/sessions/${sessionId}/hint`);
      setTranscript((prev) => [...prev, { role: 'interviewer', text: `[HINT] ${data.hint}` }]);
    } catch {
      setTranscript((prev) => [...prev, { role: 'interviewer', text: '[HINT] Could not retrieve hint. Please try again.' }]);
    }
  };

  const caseDoc = sessionData?.caseId;

  return (
    <div className="grid grid-cols-12 gap-12 flex-grow items-stretch py-8">
      {/* Left Sidebar */}
      <aside className="col-span-12 lg:col-span-3 space-y-8 flex flex-col">
        <section>
          <label className="label-blueprint mb-4 block">Current Scenario</label>
          <div className="bg-surface-container-lowest p-6 rounded-xl border-l-4 border-primary">
            {caseDoc ? (
              <>
                <h2 className="font-headline font-bold text-lg text-primary mb-2">{caseDoc.title}</h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">{caseDoc.scenario}</p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading case...</span>
              </div>
            )}
          </div>
        </section>

        {caseDoc && caseDoc.keyDataPoints.length > 0 && (
          <section className="flex-grow">
            <label className="label-blueprint mb-4 block">Key Data Points</label>
            <div className="space-y-4">
              {caseDoc.keyDataPoints.map((item, i) => (
                <div key={i} className="flex justify-between items-end border-b border-outline-variant/15 pb-2">
                  <span className="text-xs text-on-surface-variant">{item.label}</span>
                  <span className="font-headline font-bold text-primary">{item.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-auto">
          <button
            onClick={handleHint}
            disabled={wsStatus !== 'ready'}
            className="w-full flex items-center justify-center gap-2 py-4 bg-surface-container-high hover:bg-surface-container transition-all text-primary font-headline font-bold text-sm rounded-lg group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Lightbulb className="w-5 h-5 group-hover:scale-110 transition-transform" />
            Request Hint
          </button>
        </div>
      </aside>

      {/* Center: Voice Interaction */}
      <section className="col-span-12 lg:col-span-6 flex flex-col items-center justify-center py-12 relative">
        <div className="absolute inset-0 flex items-center justify-center -z-10 opacity-20 pointer-events-none">
          <div className="w-[400px] h-[400px] bg-on-tertiary-container blur-[120px] rounded-full" />
        </div>

        <div className="text-center space-y-12 w-full max-w-md">
          {wsStatus === 'error' && (
            <div className="flex items-center gap-2 justify-center text-red-500">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">{wsError || 'Voice connection error'}. You can still submit.</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              {wsStatus === 'connecting' && (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-on-tertiary-container" />
                  <span className="label-blueprint text-on-tertiary-container font-bold">Connecting to AI...</span>
                </>
              )}
              {wsStatus === 'ready' && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-on-tertiary-container opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-on-tertiary-container" />
                  </span>
                  <span className="label-blueprint text-on-tertiary-container font-bold">
                    {isAiSpeaking ? 'AI is speaking...' : 'AI is listening...'}
                  </span>
                </>
              )}
              {wsStatus === 'ended' && (
                <span className="label-blueprint text-secondary font-bold">Session ended</span>
              )}
            </div>
            <h1 className="font-headline text-2xl font-extrabold tracking-tight text-primary">
              {wsStatus === 'ready' ? 'The Partner is analyzing your response' : 'Preparing your interview session'}
            </h1>
          </div>

          {/* Voice Waveform */}
          <div className="flex items-center justify-center gap-1.5 h-20">
            {[12, 24, 48, 64, 32, 56, 18, 42, 28, 14].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: h }}
                animate={isAiSpeaking ? { height: [h, h * 1.5, h * 0.5, h] } : { height: h * 0.3 }}
                transition={isAiSpeaking ? { repeat: Infinity, duration: 1.5, delay: i * 0.1 } : { duration: 0.3 }}
                className={cn("w-1 rounded-full", isAiSpeaking ? "bg-on-tertiary-container" : "bg-primary/30")}
              />
            ))}
          </div>

          <div className="flex justify-center gap-6 pt-8">
            <button
              onClick={() => setMicMuted((m) => { micMutedRef.current = !m; return !m; })}
              disabled={wsStatus !== 'ready'}
              className={cn(
                "w-16 h-16 rounded-full transition-all flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed",
                micMuted ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest text-primary hover:bg-surface-container-high"
              )}
            >
              {micMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
            </button>
            <button
              onClick={handleStopAndSubmit}
              disabled={submitting}
              className="px-8 py-4 bg-primary text-on-primary font-headline font-bold rounded-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Stop and Submit
            </button>
            <button
              onClick={() => {
                wsRef.current?.close();
                stopMic();
                navigate('/dashboard');
              }}
              className="w-16 h-16 rounded-full bg-error-container text-on-error-container hover:bg-error/10 transition-all flex items-center justify-center shadow-sm"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        </div>
      </section>

      {/* Right Sidebar: Transcript */}
      <aside className="col-span-12 lg:col-span-3 flex flex-col py-8">
        <label className="label-blueprint mb-4 block">Conversation Log</label>
        <div className="flex-grow scrolling-log overflow-y-auto space-y-6 pr-4">
          {transcript.length === 0 && wsStatus === 'connecting' && (
            <p className="text-xs text-secondary italic">Waiting for session to start...</p>
          )}
          {transcript.map((entry, i) => (
            <div key={i} className="space-y-1">
              <div className={cn(
                "text-[10px] font-bold",
                entry.role === 'interviewer' ? "text-on-tertiary-container" : "text-primary"
              )}>
                {entry.role === 'interviewer' ? 'PARTNER (AI)' : 'CANDIDATE (YOU)'}
              </div>
              <div className={cn(
                "p-4 rounded-lg text-sm leading-relaxed",
                entry.role === 'interviewer'
                  ? "bg-surface-container-low text-on-surface-variant italic"
                  : "bg-surface-container-lowest text-primary border border-outline-variant/10"
              )}>
                {entry.text}
              </div>
            </div>
          ))}

          {liveText && (
            <div className="space-y-1">
              <div className="text-[10px] font-bold text-on-tertiary-container">PARTNER (AI)</div>
              <div className="bg-surface-container-low p-4 rounded-lg text-sm text-on-surface-variant leading-relaxed italic">
                {liveText}
                <span className="inline-block w-1 h-3 bg-on-tertiary-container ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          {wsStatus === 'ready' && !liveText && (
            <div className="flex items-center gap-2 py-4">
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse" />
                <div className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse delay-75" />
                <div className="w-1 h-1 bg-on-tertiary-container rounded-full animate-pulse delay-150" />
              </div>
              <span className="text-[10px] text-secondary font-medium italic">Transcription in progress...</span>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>
      </aside>

      {loadError && (
        <div className="col-span-12 text-center text-red-500 text-sm">{loadError}</div>
      )}
    </div>
  );
}
