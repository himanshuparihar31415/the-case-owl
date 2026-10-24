import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/src/lib/api';
import type { TranscriptEntry, WsStatus } from '@/src/hooks/useVoiceInterview';

/**
 * Live interview on the interview engine (docs/engine-contract.md). Audio goes straight between the
 * browser and OpenAI over WebRTC; the engine steers the call, and this page hears from it over its
 * UI socket: transcripts, stage, timers, notices. Node only brokers the call (`/api/voice/call`).
 *
 * Same shape as useVoiceInterview, so a session page can use either, plus what only the engine has.
 */

export type EngineStage = 'intro' | 'case' | 'wrap_up';

export interface EngineTranscriptEntry extends TranscriptEntry {
  itemId: string;
}

interface CallResponse {
  callId: string;
  sdpAnswer: string;
  ui: { url: string; token: string; expiresAt: string };
}

// The engine closes with these when the page must not reconnect: done, or a bad token/origin.
const FINAL_CLOSE = new Set([1000, 4001, 4004]);
const MAX_RECONNECTS = 6;
const PING_MS = 20_000;
const LEVEL_SPEAKING = 0.04; // RMS above this on her audio: she is speaking

export function useEngineInterview(sessionId: string | undefined) {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [error, setError] = useState('');
  const [items, setItems] = useState<EngineTranscriptEntry[]>([]);
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [thinking, setThinking] = useState<{ seconds: number } | null>(null);
  const [notice, setNotice] = useState<{ code: string; message: string } | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uiRef = useRef<CallResponse['ui'] | null>(null);
  const endedRef = useRef(false);
  const reconnectsRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /** A bubble per item: deltas grow it, a final transcript replaces its text. */
  const upsert = useCallback((role: TranscriptEntry['role'], itemId: string, text: string, append: boolean) => {
    setItems((prev) => {
      const i = prev.findIndex((e) => e.itemId === itemId);
      if (i < 0) return [...prev, { role, itemId, text }];
      const next = prev.slice();
      next[i] = { ...next[i], text: append ? next[i].text + text : text };
      return next;
    });
  }, []);

  // One peer per OpenAI call; a re-offer after a dropped connection makes a new one.
  // No data channel: the engine refuses offers with one (a page could rewrite the session through it).
  const newPeer = useCallback(async () => {
    const peer = new RTCPeerConnection();
    peer.ontrack = (e) => {
      if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      watchLevel(e.streams[0], setAiSpeaking, () => endedRef.current);
    };
    const track = streamRef.current!.getAudioTracks()[0];
    peer.addTrack(track, streamRef.current!);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') send({ type: 'audio_live' });
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return { peer, sdp: offer.sdp ?? '' };
  }, [send]);

  const reoffer = useCallback(async () => {
    if (!sessionId || endedRef.current) return;
    try { pcRef.current?.close(); } catch { /* already closed */ }
    const { peer, sdp } = await newPeer();
    pcRef.current = peer;
    const r = await api.post<{ sdpAnswer: string }>(`/voice/call/${sessionId}/reoffer`, { sdpOffer: sdp });
    await peer.setRemoteDescription({ type: 'answer', sdp: r.sdpAnswer });
  }, [newPeer, sessionId]);

  const onMessage = useCallback((m: Record<string, any>) => {
    switch (m.type) {
      case 'session_ready':
        setStatus((s) => (s === 'ended' ? s : 'ready'));
        break;
      case 'snapshot': // after a reconnect: the full picture, replacing ours
        setItems((m.transcript as EngineTranscriptEntry[]).map((t) => ({ role: t.role, text: t.text, itemId: t.itemId })));
        if (m.stage) setStage(m.stage);
        if (typeof m.remainingSeconds === 'number') setRemainingSeconds(m.remainingSeconds);
        break;
      case 'transcript_delta':
        upsert(m.role, m.itemId, m.text ?? '', true);
        break;
      case 'transcript':
        upsert(m.role, m.itemId, m.text ?? '', false);
        break;
      case 'retract': // replies cancelled before anyone heard them
        setItems((prev) => prev.filter((e) => !(m.itemIds as string[]).includes(e.itemId)));
        break;
      case 'stage':
        setStage(m.stage);
        break;
      case 'think_timer':
        setThinking(m.state === 'started' ? { seconds: m.seconds } : null);
        break;
      case 'time':
        setRemainingSeconds(m.remainingSeconds);
        break;
      case 'notice': // non-fatal by contract: show it, never enter the error state
        setNotice({ code: m.code, message: m.message });
        break;
      case 'reoffer_required':
        reoffer().catch((err: Error) => setNotice({ code: 'reconnecting', message: err.message }));
        break;
      case 'session_ended':
        endedRef.current = true;
        setEndedReason(m.reason ?? null);
        setStatus('ended');
        setAiSpeaking(false);
        break;
      case 'error':
        if (m.fatal) {
          setStatus('error');
          setError(m.message || 'Interview engine error');
        } else {
          setNotice({ code: m.code, message: m.message });
        }
        break;
    }
  }, [reoffer, upsert]);

  const openUi = useCallback(() => {
    const ui = uiRef.current;
    if (!ui || endedRef.current) return;
    const ws = new WebSocket(`${ui.url}?token=${encodeURIComponent(ui.token)}`);
    wsRef.current = ws;
    ws.onopen = () => {
      reconnectsRef.current = 0;
      if (pcRef.current?.connectionState === 'connected') send({ type: 'audio_live' });
    };
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data as string)); } catch { /* ignore a malformed frame */ }
    };
    ws.onclose = (e) => {
      if (endedRef.current || wsRef.current !== ws) return;
      if (FINAL_CLOSE.has(e.code)) {
        if (e.code !== 1000) { setStatus('error'); setError(e.reason || `Connection closed (${e.code})`); }
        return;
      }
      // 1012 (engine restarting), 1013 (interview moving to the next instance), a network drop:
      // the audio keeps flowing meanwhile, so reconnect quietly with backoff.
      if (reconnectsRef.current >= MAX_RECONNECTS) {
        setStatus('error');
        setError('Lost the connection to the interview.');
        return;
      }
      const wait = 500 * 2 ** reconnectsRef.current++;
      timersRef.current.push(window.setTimeout(openUi, wait));
    };
  }, [onMessage, send]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    endedRef.current = false;
    const audio = new Audio();
    audio.autoplay = true;
    audioRef.current = audio;

    (async () => {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        if (cancelled) return;
        const { peer, sdp } = await newPeer();
        pcRef.current = peer;
        const call = await api.post<CallResponse>('/voice/call', { sessionId, sdpOffer: sdp });
        if (cancelled) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: call.sdpAnswer });
        uiRef.current = call.ui;
        openUi();
        timersRef.current.push(window.setInterval(() => send({ type: 'ping' }), PING_MS));
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        const message = (err as Error).message || String(err);
        setError(/NotAllowed|denied/i.test(message)
          ? 'Microphone access denied. Allow mic access in your browser and reload.'
          : message);
      }
    })();

    return () => {
      cancelled = true;
      endedRef.current = true;
      timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
      timersRef.current = [];
      wsRef.current?.close(1000);
      wsRef.current = null;
      try { pcRef.current?.close(); } catch { /* already closed */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audio.srcObject = null;
    };
  }, [sessionId, newPeer, openUi, send]);

  const toggleMute = useCallback(() => {
    setMicMuted((m) => {
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = m; });
      return !m;
    });
  }, []);

  /** Typing in the scratchpad: the candidate is working, so she holds off checking in. */
  const noteActivity = useCallback(() => send({ type: 'activity', source: 'scratchpad' }), [send]);

  /** Ask the engine to end the interview. It hangs up, saves the transcript, then sends session_ended. */
  const disconnect = useCallback(() => {
    send({ type: 'end_session' });
  }, [send]);

  const transcript = useMemo(() => items.filter((e) => e.text.trim()), [items]);
  return {
    status, error, transcript, liveText: '', liveRole: 'interviewer' as const, aiSpeaking, micMuted,
    toggleMute, disconnect, noteActivity, stage, remainingSeconds, thinking, notice, endedReason,
  };
}

/** Flags `speaking` while the remote audio is above a quiet threshold (for the speaking indicator). */
function watchLevel(stream: MediaStream, setSpeaking: (on: boolean) => void, stopped: () => boolean) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let quietFrames = 0;
  const tick = () => {
    if (stopped()) { setSpeaking(false); ctx.close().catch(() => undefined); return; }
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) { const x = (b - 128) / 128; sum += x * x; }
    const loud = Math.sqrt(sum / buf.length) > LEVEL_SPEAKING;
    quietFrames = loud ? 0 : quietFrames + 1;
    setSpeaking(loud || quietFrames < 12); // ~200 ms of silence before the indicator drops
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
