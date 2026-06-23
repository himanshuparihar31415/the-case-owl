import { WebSocket } from 'ws';
import { openai } from '../../../ai/client.js';
import { PRODUCT_INTERVIEWER_PROMPT, ProductFormat } from '../../../ai/prompts.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';
import { OpenAiStt } from './openai-stt.js';
import { streamTts, TtsHandle } from './openai-tts.js';

type CaseDoc = InstanceType<typeof Case>;
type SessionDoc = InstanceType<typeof Session>;

interface PmPipelineArgs {
  clientWs: WebSocket;
  session: SessionDoc;
  caseDoc: CaseDoc;
  sessionId: string;
  minutes: number;
  style: 'supportive' | 'neutral' | 'stress';
}

const LLM_MODEL = 'gpt-4o';

// PM interviewer pipeline: STT (OpenAI transcription) → LLM (gpt-4o) → TTS
// (gpt-4o-mini-tts). This is the P1 skeleton — it proves the full audio
// round-trip + barge-in with a simple text turn. The structured per-turn
// assessment + state machine layer onto this in P2/P3.
export function handlePmPipeline(args: PmPipelineArgs): void {
  const { clientWs, session, caseDoc, sessionId, minutes, style } = args;

  const systemPrompt = PRODUCT_INTERVIEWER_PROMPT(
    (caseDoc.subType as ProductFormat) || 'design',
    caseDoc.scenario, session.config.difficulty, style, minutes,
    caseDoc.answerKey ?? caseDoc.plausibleSolution, caseDoc.privateMechanismNote, caseDoc.openingHook,
  );

  // Conversation history fed to the LLM each turn. P3 swaps this for the compact
  // state object + last-5-turns compression; for P1 we keep the full thread.
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  const stt = new OpenAiStt();
  let currentTts: TtsHandle | null = null;
  let greetingDone = false;
  let speaking = false;       // is the interviewer's TTS currently streaming?
  let llmBusy = false;        // guard against overlapping turns

  // HARD STOP: kill the session at its reserved minute cap (server-authoritative,
  // never trusts the client). Mirrors the Realtime path.
  const capTimer = setTimeout(() => {
    sendToClient(clientWs, { type: 'error', message: `Time limit reached (${minutes} min). Wrapping up your session.` });
    sendToClient(clientWs, { type: 'session_ended' });
    cleanup();
    try { clientWs.close(4008, 'Time cap reached'); } catch { /* noop */ }
  }, minutes * 60 * 1000);

  const cleanup = (): void => {
    clearTimeout(capTimer);
    currentTts?.abort();
    stt.close();
  };

  // Run one interviewer turn: call the LLM, stream the reply to TTS, persist it.
  const runInterviewerTurn = async (): Promise<void> => {
    if (llmBusy || clientWs.readyState !== WebSocket.OPEN) return;
    llmBusy = true;
    try {
      const completion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages,
        max_tokens: 300,
      });
      const reply = completion.choices[0]?.message?.content?.trim() ?? '';
      if (!reply) return;
      messages.push({ role: 'assistant', content: reply });

      // Persist + display the interviewer turn.
      sendToClient(clientWs, { type: 'transcript', role: 'interviewer', text: reply });
      appendTranscript(sessionId, { role: 'interviewer', text: reply, timestamp: new Date() })
        .catch((e) => console.error('appendTranscript (interviewer) failed:', e));

      // Speak it.
      speaking = true;
      currentTts = streamTts(reply, (chunk) => {
        if (clientWs.readyState === WebSocket.OPEN) sendToClient(clientWs, { type: 'audio_chunk', data: chunk });
      });
      try {
        await currentTts.done;
      } finally {
        speaking = false;
        currentTts = null;
        // After the greeting finishes, open the mic to the candidate.
        greetingDone = true;
      }
    } catch (err) {
      console.error('PM interviewer turn failed:', err);
      sendToClient(clientWs, { type: 'error', message: 'Interviewer turn failed' });
    } finally {
      llmBusy = false;
    }
  };

  // ---- STT wiring -----------------------------------------------------------
  stt.on('open', () => {
    sendToClient(clientWs, { type: 'session_ready' });
  });

  stt.on('partial', (text: string) => {
    sendToClient(clientWs, { type: 'transcript_delta', role: 'candidate', text });
  });

  stt.on('speechStarted', () => {
    // Barge-in: candidate started talking while the interviewer was speaking.
    if (speaking && currentTts) {
      currentTts.abort();
      speaking = false;
      sendToClient(clientWs, { type: 'speech_started' });
    }
  });

  stt.on('final', (text: string) => {
    if (!text.trim()) return;
    messages.push({ role: 'user', content: text });
    sendToClient(clientWs, { type: 'transcript', role: 'candidate', text });
    appendTranscript(sessionId, { role: 'candidate', text, timestamp: new Date() })
      .catch((e) => console.error('appendTranscript (candidate) failed:', e));
    void runInterviewerTurn();
  });

  stt.on('error', (message: string) => {
    console.error('PM STT error:', message);
    sendToClient(clientWs, { type: 'error', message });
  });

  stt.on('close', () => {
    sendToClient(clientWs, { type: 'session_ended' });
    cleanup();
    try { clientWs.close(); } catch { /* noop */ }
  });

  stt.connect();

  // ---- Client wiring --------------------------------------------------------
  clientWs.on('message', (data: Buffer) => {
    let message: Record<string, unknown>;
    try { message = JSON.parse(data.toString()); } catch { return; }

    if (message.type === 'audio_live') {
      // Mic + speaker pipeline is live — fire the opening interviewer turn so it
      // lands in a live pipeline (mirrors the Realtime greeting gate).
      messages.push({ role: 'user', content: '[The candidate just joined. Greet them warmly, do a quick audio check, then present the prompt.]' });
      void runInterviewerTurn();
    } else if (message.type === 'audio_chunk') {
      // Gate candidate audio until the greeting finishes so mic-startup noise
      // doesn't false-trigger VAD before the interviewer has spoken.
      if (!greetingDone || typeof message.data !== 'string') return;
      stt.appendAudio(message.data);
    } else if (message.type === 'end_session') {
      cleanup();
      try { clientWs.close(); } catch { /* noop */ }
    }
  });

  clientWs.on('close', () => {
    cleanup();
    settleSession(sessionId).catch((e) => console.error('settleSession (pm ws close) failed:', e));
  });

  clientWs.on('error', (err: Error) => {
    console.error('PM client WS error:', err.message);
    cleanup();
  });
}

function sendToClient(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
