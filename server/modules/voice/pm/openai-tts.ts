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

    // OpenAI streams raw PCM16 in arbitrary byte-sized chunks — a chunk can end
    // mid-sample (odd length). The browser decodes via Int16Array, which THROWS
    // on an odd-length buffer (dropping that chunk) and mis-aligns everything
    // after a split sample → garbled / breaking audio. So we buffer, emit only
    // sample-aligned (even-length) slices, carry the leftover odd byte forward,
    // and coalesce to ~50ms so we don't spray hundreds of tiny AudioBuffers.
    const MIN_EMIT_BYTES = 2400; // 50ms @ 24kHz mono 16-bit (2 bytes/sample)
    let carry = Buffer.alloc(0);
    const reader = res.body.getReader();
    for (;;) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      if (!value || !value.length) continue;
      carry = carry.length ? Buffer.concat([carry, Buffer.from(value)]) : Buffer.from(value);
      if (carry.length < MIN_EMIT_BYTES) continue;
      const aligned = carry.length - (carry.length % 2); // largest even-length prefix
      onChunk(carry.subarray(0, aligned).toString('base64'));
      carry = aligned < carry.length ? Buffer.from(carry.subarray(aligned)) : Buffer.alloc(0);
    }
    // Flush the tail (drop a lone trailing odd byte — inaudible).
    const tail = carry.length - (carry.length % 2);
    if (tail > 0) onChunk(carry.subarray(0, tail).toString('base64'));
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
