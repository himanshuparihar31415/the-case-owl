import { env } from '../../../config/env.js';

// TTS half of the PM pipeline. Streams the interviewer's text to OpenAI's speech
// endpoint and yields PCM16 @ 24kHz chunks as base64 — the exact `audio_chunk`
// format the browser already plays. The returned handle is abortable so the
// orchestrator can cut playback the instant the candidate barges in.
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

export interface TtsHandle {
  /** Resolves when the full utterance has streamed (or rejects on error/abort). */
  done: Promise<void>;
  /** Cut the stream immediately (barge-in). Safe to call multiple times. */
  abort: () => void;
}

/**
 * Stream `text` to TTS, invoking `onChunk` with each base64 PCM16@24k chunk.
 * Chunks are forwarded as they arrive so the browser starts playing before the
 * full clip is synthesized.
 */
export function streamTts(text: string, onChunk: (base64Pcm: string) => void): TtsHandle {
  const controller = new AbortController();

  const done = (async () => {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server');
    if (!text.trim()) return;

    const res = await fetch(SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_TTS_MODEL,
        voice: env.OPENAI_TTS_VOICE,
        input: text,
        // Raw 24kHz mono PCM16 — drops straight into the browser AudioContext.
        response_format: 'pcm',
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      if (value && value.length) {
        onChunk(Buffer.from(value).toString('base64'));
      }
    }
  })();

  // Swallow the AbortError so barge-in doesn't surface as an unhandled rejection;
  // genuine errors still reject for the caller to handle.
  const guarded = done.catch((err: unknown) => {
    if (controller.signal.aborted) return;
    throw err;
  });

  return {
    done: guarded,
    abort: () => { try { controller.abort(); } catch { /* noop */ } },
  };
}
