import { env } from '../../../config/env.js';

// TTS half of the PM pipeline. We synthesize the FULL utterance, then emit it in
// cleanly sample-aligned fixed chunks all at once — NOT progressive HTTP
// streaming. Progressive streaming produced garbled/breaking audio (arbitrary
// byte boundaries split 16-bit samples, and bursty network pacing starved the
// browser's playback scheduler). PM interviews tolerate a ~1-2s synthesis pause
// (it reads as a natural "thinking" beat), so full-synthesis is the robust call.
// Output is base64 PCM16 @ 24kHz — the exact `audio_chunk` format the browser
// already plays. The handle is abortable so barge-in can stop synthesis.
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

// 0.5s of audio per chunk (even byte count → always sample-aligned, since PCM16
// is 2 bytes/sample and 24000 is even). Small enough for smooth scheduling.
const CHUNK_BYTES = 24000;

export interface TtsHandle {
  /** Resolves when the full utterance has been emitted (or rejects on error). */
  done: Promise<void>;
  /** Cut synthesis/emit immediately (barge-in). Safe to call multiple times. */
  abort: () => void;
}

/** Synthesize `text`, then emit it as base64 PCM16@24k chunks via `onChunk`. */
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

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // Read the WHOLE clip, then emit aligned fixed chunks. PCM16 length is always
    // even; CHUNK_BYTES is even → every slice is sample-aligned by construction.
    const full = Buffer.from(await res.arrayBuffer());
    for (let off = 0; off < full.length; off += CHUNK_BYTES) {
      if (controller.signal.aborted) break;
      onChunk(full.subarray(off, Math.min(off + CHUNK_BYTES, full.length)).toString('base64'));
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
