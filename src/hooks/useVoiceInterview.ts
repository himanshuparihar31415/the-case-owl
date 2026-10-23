import { useCallback, useEffect, useRef, useState } from 'react';
import { getWsUrl } from '@/src/lib/api';

export interface TranscriptEntry {
  role: 'interviewer' | 'candidate';
  text: string;
}

export type WsStatus = 'connecting' | 'ready' | 'ended' | 'error';

/**
 * Live spoken-interview connection for the STT→LLM→TTS voice pipeline
 * (`/api/voice`). Owns the WebSocket, mic capture (24 kHz PCM16) and AI audio
 * playback with barge-in, and exposes the transcript state. Same wire protocol
 * the case / guesstimate Session page speaks.
 */
export function useVoiceInterview(sessionId: string | undefined, wsPath = '/api/voice') {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveText, setLiveText] = useState('');
  const [liveRole, setLiveRole] = useState<'interviewer' | 'candidate'>('candidate');
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micMutedRef = useRef(false);

  const playChunk = useCallback((base64: string) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    try {
      const raw = atob(base64);
      const usable = raw.length - (raw.length % 2); // Int16Array needs an even byte count
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
      setAiSpeaking(true);
      activeSourcesRef.current.push(src);
      src.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
        if (nextPlayTimeRef.current <= ctx.currentTime + 0.05) setAiSpeaking(false);
      };
    } catch {
      // ignore undecodable chunk
    }
  }, []);

  // Barge-in: cut all queued AI audio the moment the candidate starts talking.
  const flushPlayback = useCallback(() => {
    const ctx = playbackCtxRef.current;
    for (const src of activeSourcesRef.current) {
      try { src.onended = null; src.stop(); } catch { /* already stopped */ }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = ctx ? ctx.currentTime : 0;
    setAiSpeaking(false);
  }, []);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    captureCtxRef.current?.close().catch(() => undefined);
    captureCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const startMic = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    navigator.mediaDevices.getUserMedia({
      // Browser DSP keeps the AI's own voice and room noise out of the server VAD.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then((stream) => {
      micStreamRef.current = stream;
      // Must match the 24 kHz input rate the server declares to the STT.
      const ctx = new AudioContext({ sampleRate: 24000 });
      captureCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(ctx.destination);

      // First audio frame = mic pipeline is truly live: tell the server so the
      // interviewer's opening is not clipped.
      let liveSent = false;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!liveSent) { liveSent = true; ws.send(JSON.stringify({ type: 'audio_live' })); }
        if (micMutedRef.current) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 32768 : s * 32767;
        }
        const bytes = new Uint8Array(i16.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        ws.send(JSON.stringify({ type: 'audio_chunk', data: btoa(bin) }));
      };
    }).catch((err: Error) => {
      setStatus('error');
      setError(`Microphone access denied: ${err.message}. Allow mic access in your browser and reload.`);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const ws = new WebSocket(getWsUrl(wsPath, { sessionId }));
    wsRef.current = ws;
    const playback = new AudioContext({ sampleRate: 24000 });
    playbackCtxRef.current = playback;
    playback.resume().catch(() => undefined);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case 'session_ready':
            setStatus('ready');
            startMic();
            break;
          case 'audio_chunk':
            playChunk(msg.data as string);
            break;
          case 'speech_started':
            flushPlayback();
            setLiveText(''); // interrupted interviewer turn: drop its partial caption
            break;
          case 'transcript_delta':
            setLiveRole((msg.role as 'interviewer' | 'candidate') || 'candidate');
            setLiveText((prev) => prev + ((msg.text as string) ?? '')); // STT partials are deltas
            break;
          case 'transcript':
            setTranscript((prev) => [...prev, { role: msg.role as 'interviewer' | 'candidate', text: msg.text as string }]);
            setLiveText('');
            break;
          case 'session_ended':
            setStatus('ended');
            setAiSpeaking(false);
            break;
          case 'error':
            setStatus('error');
            setAiSpeaking(false);
            setError((msg.message as string) || 'Voice service error');
            break;
        }
      } catch {
        // ignore malformed frame
      }
    };

    ws.onclose = (event) => {
      if (cancelled) return;
      if (event.code === 1000 || event.code === 1001) {
        setStatus((s) => (s === 'ready' ? 'ended' : s));
      } else {
        setStatus((s) => (s === 'ended' ? s : 'error'));
        setError((prev) => prev || event.reason || `Connection closed (code ${event.code})`);
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      stopMic();
      playbackCtxRef.current?.close().catch(() => undefined);
      playbackCtxRef.current = null;
    };
  }, [sessionId, wsPath, playChunk, startMic, stopMic, flushPlayback]);

  const toggleMute = useCallback(() => {
    setMicMuted((m) => { micMutedRef.current = !m; return !m; });
  }, []);

  /** Tell the server we are done and release the mic + speakers. */
  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end_session' }));
    ws?.close();
    stopMic();
    playbackCtxRef.current?.close().catch(() => undefined);
    playbackCtxRef.current = null;
  }, [stopMic]);

  return { status, error, transcript, liveText, liveRole, aiSpeaking, micMuted, toggleMute, disconnect };
}
