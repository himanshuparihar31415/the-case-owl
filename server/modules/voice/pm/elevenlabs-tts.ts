import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { env } from '../../../config/env.js';

// TTS half of the PM pipeline (ElevenLabs). We synthesize the FULL utterance,
// then emit it in cleanly sample-aligned fixed chunks all at once — NOT
// progressive streaming. Progressive PCM streaming produced garbled/breaking
// audio (split 16-bit samples at byte boundaries + bursty pacing starving the
// browser scheduler); full-synthesis avoids both and the PM format's ~1-2s
// pause reads as a natural "thinking" beat. Output is pcm_24000 (raw 16-bit PCM
// @ 24kHz) — the exact `audio_chunk` format the browser already plays.

let client: ElevenLabsClient | null = null;
function getClient(): ElevenLabsClient {
  if (!client) {
    if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not configured on the server');
    client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });
  }
  return client;
}

// 0.5s of audio per chunk (even byte count → always sample-aligned, since PCM16
// is 2 bytes/sample and 24000 is even). Small enough for smooth scheduling.
const CHUNK_BYTES = 24000;

export interface TtsHandle {
  /** Resolves when the full utterance has been emitted (or rejects on error). */
  done: Promise<void>;
  /** Cut synthesis/emit immediately (barge-in). Safe to call multiple times. */
  abort: () => void;
}

// Collect the SDK's audio response (web ReadableStream or async iterable) into a
// single Buffer.
async function collect(audio: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const a = audio as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } & AsyncIterable<Uint8Array>;
  if (typeof a?.getReader === 'function') {
    const reader = a.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } else if (a && typeof a[Symbol.asyncIterator] === 'function') {
    for await (const c of a) chunks.push(Buffer.from(c));
  } else {
    chunks.push(Buffer.from(audio as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Synthesize `text`, then emit it as base64 PCM16@24k chunks via `onChunk`. */
export function streamTts(text: string, onChunk: (base64Pcm: string) => void): TtsHandle {
  const controller = new AbortController();

  const done = (async () => {
    if (!text.trim()) return;
    const audio = await getClient().textToSpeech.convert(
      env.ELEVENLABS_VOICE_ID,
      {
        text, modelId: env.ELEVENLABS_MODEL_ID, outputFormat: 'pcm_24000',
        voiceSettings: { speed: env.ELEVENLABS_SPEED },
      },
      { abortSignal: controller.signal },
    );

    const full = await collect(audio);
    // PCM16 length is always even; CHUNK_BYTES is even → every slice is aligned.
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
