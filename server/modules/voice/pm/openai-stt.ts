import WebSocketNode from 'ws';
import { EventEmitter } from 'events';
import { env } from '../../../config/env.js';

// OpenAI Realtime API in transcription-only mode (intent=transcription). This is
// the STT half of the PM pipeline: it streams the candidate's mic audio in,
// emits partial + final transcripts, and (via server_vad) tells us when the
// candidate has stopped talking — the "turn complete" signal the orchestrator
// waits on before firing the LLM. We deliberately reuse the VAD knobs proven out
// on the full Realtime path (threshold 0.63, 1330ms silence, 400ms prefix).
//
// Events emitted:
//   'open'                       — STT session configured and ready for audio
//   'partial' (text: string)     — interim transcript delta (for live display)
//   'final'   (text: string)     — a completed candidate utterance
//   'speechStarted'              — candidate began speaking (barge-in trigger)
//   'speechStopped'              — VAD detected end of speech
//   'error'   (message: string)
//   'close'   (code, reason)
const STT_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

export interface SttVadConfig {
  threshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
}

const DEFAULT_VAD: SttVadConfig = {
  threshold: 0.63,
  prefixPaddingMs: 400,
  silenceDurationMs: 1330,
};

export class OpenAiStt extends EventEmitter {
  private ws: WebSocketNode | null = null;
  private ready = false;

  constructor(private vad: SttVadConfig = DEFAULT_VAD) {
    super();
  }

  connect(): void {
    if (!env.OPENAI_API_KEY) {
      this.emit('error', 'OPENAI_API_KEY is not configured on the server');
      return;
    }
    const ws = new WebSocketNode(STT_URL, {
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      // Configure the transcription session. GA Realtime uses the standard
      // `session.update` event (NOT transcription_session.update) with the nested
      // audio schema — same shape as the full Realtime path, just type
      // 'transcription' and input-only. PCM @ 24kHz matches the browser capture.
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: { model: 'gpt-4o-transcribe' },
              turn_detection: {
                type: 'server_vad',
                threshold: this.vad.threshold,
                prefix_padding_ms: this.vad.prefixPaddingMs,
                silence_duration_ms: this.vad.silenceDurationMs,
              },
            },
          },
        },
      }));
    });

    ws.on('message', (data: Buffer) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(data.toString()); } catch { return; }
      const type = String(event.type ?? '');

      switch (type) {
        case 'session.created':
        case 'session.updated':
        case 'transcription_session.created':
        case 'transcription_session.updated':
          if (!this.ready) {
            this.ready = true;
            this.emit('open');
          }
          break;
        case 'input_audio_buffer.speech_started':
          this.emit('speechStarted');
          break;
        case 'input_audio_buffer.speech_stopped':
          this.emit('speechStopped');
          break;
        case 'conversation.item.input_audio_transcription.delta':
          if (event.delta) this.emit('partial', String(event.delta));
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript) this.emit('final', String(event.transcript));
          break;
        case 'error':
          this.emit('error', String((event.error as { message?: string })?.message ?? 'OpenAI STT error'));
          break;
        default:
          break;
      }
    });

    ws.on('error', (err: Error) => this.emit('error', String(err?.message ?? err)));
    ws.on('close', (code: number, reason: Buffer) => {
      this.ready = false;
      this.emit('close', code, reason?.toString?.() ?? '');
    });
  }

  /** Append a base64-encoded PCM16 @ 24kHz audio chunk from the browser. */
  appendAudio(base64Pcm: string): void {
    if (this.ws?.readyState === WebSocketNode.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Pcm }));
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  close(): void {
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this.ready = false;
  }
}
