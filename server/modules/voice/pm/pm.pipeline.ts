import { WebSocket } from 'ws';
import { ProductFormat } from '../../../ai/prompts.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';
import { OpenAiStt } from './openai-stt.js';
import { streamTts, TtsHandle } from './openai-tts.js';
import { PmState } from './pm.state.js';
import { pmTurn, PmTurnSystemArgs } from './pm.turn.js';

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

// PM interviewer pipeline: STT (OpenAI transcription) → LLM (gpt-4o, structured
// dual-purpose turn) → TTS (gpt-4o-mini-tts). Each candidate turn yields the
// interviewer's spoken reply AND a structured assessment, which we persist live
// (§7) and feed into the compact state object (§8) for the next turn.
export function handlePmPipeline(args: PmPipelineArgs): void {
  const { clientWs, session, caseDoc, sessionId, minutes, style } = args;

  const format = (caseDoc.subType as ProductFormat) || 'design';
  const startedAt = Date.now();

  // Static system args (product context + private guide) reused every turn.
  const systemArgs: PmTurnSystemArgs = {
    format,
    productContext: caseDoc.scenario,
    prompt: caseDoc.prompt ?? caseDoc.scenario,
    interviewerStyle: style,
    durationMinutes: minutes,
    guide: caseDoc.privateMechanismNote ?? undefined,
    answerKey: caseDoc.answerKey ?? caseDoc.plausibleSolution ?? undefined,
    openingHook: caseDoc.openingHook,
  };

  const state = new PmState({
    product: caseDoc.scenario,
    prompt: caseDoc.prompt ?? caseDoc.scenario,
    format,
    difficulty: session.config.difficulty,
  });

  // Live-accumulated assessment artifacts, flushed to the Session on close.
  const turnAssessments: unknown[] = [];

  const stt = new OpenAiStt();
  let currentTts: TtsHandle | null = null;
  let greetingDone = false;
  let speaking = false;       // is the interviewer's audio still playing on the client?
  let llmBusy = false;        // guard against overlapping turns

  // The interviewer audio is fully synthesized then sent in one burst, but the
  // browser keeps PLAYING it for `duration` afterward. We hold `speaking` true
  // for the real playback duration (estimated from PCM byte count) so barge-in
  // and turn pacing track what the candidate actually hears, not when bytes left
  // the server. `endPlayback` resolves the wait early on barge-in.
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackResolve: (() => void) | null = null;
  const endPlayback = (): void => {
    if (playbackTimer) { clearTimeout(playbackTimer); playbackTimer = null; }
    if (playbackResolve) { const r = playbackResolve; playbackResolve = null; r(); }
  };

  // HARD STOP: kill the session at its reserved minute cap (server-authoritative,
  // never trusts the client). Mirrors the Realtime path.
  const capTimer = setTimeout(() => {
    sendToClient(clientWs, { type: 'error', message: `Time limit reached (${minutes} min). Wrapping up your session.` });
    sendToClient(clientWs, { type: 'session_ended' });
    cleanup();
    try { clientWs.close(4008, 'Time cap reached'); } catch { /* noop */ }
  }, minutes * 60 * 1000);

  let flushed = false;
  const flushState = (): void => {
    if (flushed) return;
    flushed = true;
    Session.updateOne({ _id: sessionId }, {
      $set: {
        interviewType: 'pm',
        turnAssessments,
        stateObject: state.snapshot(),
        stageTransitions: state.getStageTransitions(),
      },
    }).catch((e) => console.error('PM flushState failed:', e));
  };

  const cleanup = (): void => {
    clearTimeout(capTimer);
    if (bargeInTimer) { clearTimeout(bargeInTimer); bargeInTimer = null; }
    endPlayback();
    currentTts?.abort();
    stt.close();
    flushState();
  };

  // Run one interviewer turn: structured LLM call → persist assessment + advance
  // state → stream the spoken reply to TTS. `transcript` is the candidate's last
  // utterance; for the opening turn it's a synthetic cue and isOpening=true.
  const runInterviewerTurn = async (transcript: string, isOpening = false): Promise<void> => {
    if (llmBusy || clientWs.readyState !== WebSocket.OPEN) return;
    llmBusy = true;
    try {
      const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
      const result = await pmTurn({
        system: systemArgs,
        stateBlock: state.serialize(),
        recentTurns: state.recentTurnsText(),
        transcript,
        elapsedMin,
        totalMin: minutes,
      });
      const reply = result.response.trim();
      if (!reply) return;

      // Live assessment + state machine update (skip the meaningless opening one).
      if (!isOpening) {
        turnAssessments.push({ t: new Date().toISOString(), ...result.turn_assessment, next_action: result.next_action });
        state.applyTurn(result.turn_assessment.response_quality, result.state_update);
      }
      state.recordTurn('interviewer', reply);

      // Persist + display the interviewer turn.
      sendToClient(clientWs, { type: 'transcript', role: 'interviewer', text: reply });
      appendTranscript(sessionId, { role: 'interviewer', text: reply, timestamp: new Date() })
        .catch((e) => console.error('appendTranscript (interviewer) failed:', e));

      // Synthesize + send the audio, then hold `speaking` for the real playback
      // duration so barge-in works while the candidate is actually hearing it.
      speaking = true;
      let pcmBytes = 0; // decoded PCM byte count, for the playback-duration estimate
      currentTts = streamTts(reply, (chunk) => {
        pcmBytes += (chunk.length * 3) >> 2; // base64 → bytes (≈, ignoring padding)
        if (clientWs.readyState === WebSocket.OPEN) sendToClient(clientWs, { type: 'audio_chunk', data: chunk });
      });
      try {
        await currentTts.done; // all chunks sent to the client
        // PCM16 @ 24kHz mono = 48000 bytes/sec. Pad a little for scheduling tail.
        const durationMs = (pcmBytes / 48000) * 1000 + 150;
        await new Promise<void>((resolve) => {
          playbackResolve = resolve;
          playbackTimer = setTimeout(endPlayback, durationMs);
        });
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

  // Barge-in is gated behind a short sustained-speech window so a stray VAD blip
  // (a cough, a keystroke, brief room noise) doesn't truncate the interviewer's
  // question. We only cut the interviewer off if speech persists past the window.
  // (Candidates must be on headphones — otherwise the interviewer's own TTS loops
  // into the mic as sustained "speech" and self-interrupts.)
  const BARGE_IN_MS = 450;
  let bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  const clearBargeIn = (): void => { if (bargeInTimer) { clearTimeout(bargeInTimer); bargeInTimer = null; } };

  stt.on('speechStarted', () => {
    if (!speaking || bargeInTimer) return;
    bargeInTimer = setTimeout(() => {
      bargeInTimer = null;
      if (speaking) {
        currentTts?.abort();
        sendToClient(clientWs, { type: 'speech_started' }); // client flushes queued audio
        endPlayback(); // resolve the playback wait → frees the turn
      }
    }, BARGE_IN_MS);
  });

  stt.on('speechStopped', () => {
    // Speech ended before the window elapsed → a blip, not a real interruption.
    clearBargeIn();
  });

  stt.on('final', (text: string) => {
    if (!text.trim()) return;
    state.recordTurn('candidate', text);
    sendToClient(clientWs, { type: 'transcript', role: 'candidate', text });
    appendTranscript(sessionId, { role: 'candidate', text, timestamp: new Date() })
      .catch((e) => console.error('appendTranscript (candidate) failed:', e));
    void runInterviewerTurn(text);
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
      void runInterviewerTurn('[The candidate just joined. Do a quick audio check, then once confirmed greet them and present the prompt.]', true);
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
