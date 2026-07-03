import { WebSocket } from 'ws';
import { openai } from '../../../ai/client.js';
import { GUESSTIMATE_INTERVIEWER_PROMPT } from '../../../ai/prompts.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';
import { OpenAiStt } from './openai-stt.js';
import { streamTts, TtsHandle } from './elevenlabs-tts.js';
import { buildForbiddenList, deterministicCheck } from '../supervisor.js';

// Run a GUESSTIMATE / market-sizing drill on the STT→LLM→TTS pipeline (OpenAI
// transcription + gpt-4o + ElevenLabs). Simpler than the consulting pipeline:
// no exhibits and no tools — just probe the candidate's structure, assumptions,
// arithmetic, and sanity-check. The silent supervisor still records LED/FED_DATA
// flags so the interviewer can't hand them a number they hadn't earned.

type CaseDoc = InstanceType<typeof Case>;
type SessionDoc = InstanceType<typeof Session>;

interface Args {
  clientWs: WebSocket;
  session: SessionDoc;
  caseDoc: CaseDoc;
  sessionId: string;
  minutes: number;
  style: 'supportive' | 'neutral' | 'stress';
}

const LLM_MODEL = 'gpt-4o';

export function handleGuesstimatePipeline(args: Args): void {
  const { clientWs, session, caseDoc, sessionId, minutes, style } = args;

  const systemPrompt = GUESSTIMATE_INTERVIEWER_PROMPT(
    caseDoc.scenario, session.config.difficulty, style, minutes,
    caseDoc.answerKey ?? caseDoc.plausibleSolution, caseDoc.privateMechanismNote,
  );

  // Full conversation thread for the chat-completion turns.
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }];

  // Silent supervisor: flag if the interviewer feeds an assumption/number the
  // candidate hadn't earned. Observe-only, deduped per term.
  const forbidden = buildForbiddenList(caseDoc);
  const candidateHistory: string[] = [];
  const flaggedTerms = new Set<string>();

  const stt = new OpenAiStt();
  let currentTts: TtsHandle | null = null;
  let greetingDone = false;
  let speaking = false;
  let llmBusy = false;

  // Hold `speaking` for the real playback duration (audio is sent in one burst
  // but plays over several seconds) so barge-in tracks what's actually heard.
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackResolve: (() => void) | null = null;
  const endPlayback = (): void => {
    if (playbackTimer) { clearTimeout(playbackTimer); playbackTimer = null; }
    if (playbackResolve) { const r = playbackResolve; playbackResolve = null; r(); }
  };

  const capTimer = setTimeout(() => {
    sendToClient(clientWs, { type: 'error', message: `Time limit reached (${minutes} min). Wrapping up your session.` });
    sendToClient(clientWs, { type: 'session_ended' });
    cleanup();
    try { clientWs.close(4008, 'Time cap reached'); } catch { /* noop */ }
  }, minutes * 60 * 1000);

  let bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = (): void => {
    clearTimeout(capTimer);
    if (bargeInTimer) { clearTimeout(bargeInTimer); bargeInTimer = null; }
    endPlayback();
    currentTts?.abort();
    stt.close();
  };

  // One interviewer turn: LLM → spoken reply → ElevenLabs TTS. `transcript` is
  // the candidate's last utterance.
  const runInterviewerTurn = async (transcript: string, isOpening = false): Promise<void> => {
    if (llmBusy || clientWs.readyState !== WebSocket.OPEN) return;
    llmBusy = true;
    try {
      messages.push({ role: 'user', content: isOpening
        ? '[The candidate just joined. Do a quick audio check, then once they confirm, greet them and pose the estimation question.]'
        : transcript });

      const completion = await openai.chat.completions.create({
        model: LLM_MODEL, messages: messages as never, max_tokens: 400,
      });
      const reply = (completion.choices[0]?.message?.content ?? '').trim();
      if (!reply) return;
      messages.push({ role: 'assistant', content: reply });

      sendToClient(clientWs, { type: 'transcript', role: 'interviewer', text: reply });
      appendTranscript(sessionId, { role: 'interviewer', text: reply, timestamp: new Date() })
        .catch((e) => console.error('appendTranscript (interviewer) failed:', e));

      // Supervisor (observe-only): flag if this turn led or fed unearned data.
      const check = deterministicCheck(reply, candidateHistory, forbidden);
      if (check.verdict !== 'OK' && check.term && !flaggedTerms.has(check.term)) {
        flaggedTerms.add(check.term);
        console.warn(`[supervisor] session=${sessionId} ${check.verdict} term="${check.term}"`);
        Session.updateOne(
          { _id: sessionId },
          { $push: { supervisorFlags: { verdict: check.verdict, term: check.term, at: new Date().toISOString() } } }
        ).catch((e) => console.error('supervisorFlags persist failed:', e));
      }

      speaking = true;
      let pcmBytes = 0;
      currentTts = streamTts(reply, (chunk) => {
        pcmBytes += (chunk.length * 3) >> 2;
        if (clientWs.readyState === WebSocket.OPEN) sendToClient(clientWs, { type: 'audio_chunk', data: chunk });
      }, session.config.voiceId);
      try {
        await currentTts.done;
        const durationMs = (pcmBytes / 48000) * 1000 + 150; // PCM16@24kHz = 48000 B/s
        await new Promise<void>((resolve) => { playbackResolve = resolve; playbackTimer = setTimeout(endPlayback, durationMs); });
      } finally {
        speaking = false; currentTts = null; greetingDone = true;
      }
    } catch (err) {
      const detail = String((err as { message?: string })?.message ?? err);
      console.error('Guesstimate interviewer turn failed:', err);
      sendToClient(clientWs, { type: 'error', message: `Interviewer turn failed: ${detail}` });
    } finally {
      llmBusy = false;
    }
  };

  // ---- STT wiring ----
  stt.on('open', () => sendToClient(clientWs, { type: 'session_ready' }));
  stt.on('partial', (text: string) => sendToClient(clientWs, { type: 'transcript_delta', role: 'candidate', text }));

  const BARGE_IN_MS = 450;
  const clearBargeIn = (): void => { if (bargeInTimer) { clearTimeout(bargeInTimer); bargeInTimer = null; } };
  stt.on('speechStarted', () => {
    if (!speaking || bargeInTimer) return;
    bargeInTimer = setTimeout(() => {
      bargeInTimer = null;
      if (speaking) { currentTts?.abort(); sendToClient(clientWs, { type: 'speech_started' }); endPlayback(); }
    }, BARGE_IN_MS);
  });
  stt.on('speechStopped', () => clearBargeIn());

  stt.on('final', (text: string) => {
    if (!text.trim()) return;
    candidateHistory.push(text); // supervisor: what the candidate has earned
    sendToClient(clientWs, { type: 'transcript', role: 'candidate', text });
    appendTranscript(sessionId, { role: 'candidate', text, timestamp: new Date() })
      .catch((e) => console.error('appendTranscript (candidate) failed:', e));
    void runInterviewerTurn(text);
  });

  stt.on('error', (message: string) => { console.error('Guesstimate STT error:', message); sendToClient(clientWs, { type: 'error', message }); });
  stt.on('close', () => { sendToClient(clientWs, { type: 'session_ended' }); cleanup(); try { clientWs.close(); } catch { /* noop */ } });
  stt.connect();

  // ---- Client wiring ----
  clientWs.on('message', (data: Buffer) => {
    let message: Record<string, unknown>;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.type === 'audio_live') {
      void runInterviewerTurn('', true);
    } else if (message.type === 'audio_chunk') {
      if (!greetingDone || typeof message.data !== 'string') return;
      stt.appendAudio(message.data);
    } else if (message.type === 'end_session') {
      cleanup();
      try { clientWs.close(); } catch { /* noop */ }
    }
  });

  clientWs.on('close', () => {
    cleanup();
    settleSession(sessionId).catch((e) => console.error('settleSession (guesstimate ws close) failed:', e));
  });
  clientWs.on('error', (err: Error) => { console.error('Guesstimate client WS error:', err.message); cleanup(); });
}

function sendToClient(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
