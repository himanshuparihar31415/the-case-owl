import { WebSocket } from 'ws';
import { openai } from '../../../ai/client.js';
import { INTERVIEWER_SYSTEM_PROMPT } from '../../../ai/prompts.js';
import { CaseType } from '../../../models/Case.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';
import { OpenAiStt } from './openai-stt.js';
import { streamTts, TtsHandle } from './elevenlabs-tts.js';

// EXPERIMENTAL: run a CONSULTING case on the STT→LLM→TTS pipeline (OpenAI
// transcription + gpt-4o + ElevenLabs) instead of the all-in-one Realtime model.
// Gated to energy-profitability only (see voice.ws.ts). Uses the SAME consulting
// interviewer prompt + exhibit framework as the Realtime path — exhibits are
// surfaced via gpt-4o function-calling (the chat-completion analog of the
// Realtime show_exhibit tool). Nothing else (case gen, report) changes.

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

export function handleConsultingPipeline(args: Args): void {
  const { clientWs, session, caseDoc, sessionId, minutes, style } = args;

  const exhibits = caseDoc.exhibits ?? [];
  const hasExhibits = exhibits.length > 0;
  const exhibitsById = new Map<number, NonNullable<CaseDoc['exhibits']>[number]>();
  exhibits.forEach((e, i) => exhibitsById.set(typeof e?.id === 'number' ? e.id : i + 1, e));

  const systemPrompt = INTERVIEWER_SYSTEM_PROMPT(
    caseDoc.title, caseDoc.scenario, caseDoc.keyDataPoints, caseDoc.type as CaseType,
    session.config.difficulty, style, minutes, caseDoc.plausibleSolution, caseDoc.openingHook,
    hasExhibits ? { exhibits, quant: caseDoc.quant, privateMechanism: caseDoc.privateMechanismNote } : undefined,
  );

  // Full conversation thread for the chat-completion turns.
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }];

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

  // Reveal an exhibit on the candidate's screen (same WS frame the UI renders).
  const showExhibit = (argsStr: string | undefined): string => {
    let exhibitId: number | undefined;
    try { exhibitId = JSON.parse(argsStr || '{}').exhibitId; } catch { /* bad args */ }
    const ex = exhibitId != null ? exhibitsById.get(Number(exhibitId)) : undefined;
    if (!ex) return `No exhibit ${exhibitId} exists.`;
    const e = ex as Record<string, unknown>;
    sendToClient(clientWs, {
      type: 'exhibit',
      exhibit: { id: e.id, label: e.label, visual: e.visual, render: e.render, chartType: e.chartType, xKey: e.xKey, series: e.series, chartData: e.chartData, columns: e.columns, rows: e.rows, data: e.data },
    });
    console.log(`[consulting-pipeline] exhibit #${exhibitId} (${(ex as { label?: string }).label ?? ''})`);
    return `Exhibit ${exhibitId} is now on the candidate's screen.`;
  };

  const TOOLS = [{
    type: 'function' as const,
    function: {
      name: 'show_exhibit',
      description: "Display a case exhibit (chart or table) on the candidate's screen once they have earned it. Call this BEFORE discussing the exhibit.",
      parameters: { type: 'object', properties: { exhibitId: { type: 'number', description: 'the exhibit number (#id) to reveal' } }, required: ['exhibitId'] },
    },
  }];

  // One interviewer turn: LLM (with exhibit tool) → resolve any tool calls →
  // spoken reply → ElevenLabs TTS. `transcript` is the candidate's last utterance.
  const runInterviewerTurn = async (transcript: string, isOpening = false): Promise<void> => {
    if (llmBusy || clientWs.readyState !== WebSocket.OPEN) return;
    llmBusy = true;
    try {
      messages.push({ role: 'user', content: isOpening
        ? '[The candidate just joined. Do a quick audio check, then once they confirm, greet them and pose the case.]'
        : transcript });

      let reply = '';
      for (let i = 0; i < 4; i++) {
        const completion = await openai.chat.completions.create({
          model: LLM_MODEL, messages: messages as never, max_tokens: 400,
          ...(hasExhibits ? { tools: TOOLS, tool_choice: 'auto' as const } : {}),
        });
        const msg = completion.choices[0]?.message;
        if (msg?.tool_calls?.length) {
          messages.push(msg as unknown as Record<string, unknown>);
          for (const tc of msg.tool_calls) {
            const out = tc.type === 'function' && tc.function?.name === 'show_exhibit' ? showExhibit(tc.function.arguments) : 'Unknown tool.';
            messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
          }
          continue; // re-call so the model produces its spoken line after the tool
        }
        reply = (msg?.content ?? '').trim();
        if (reply) messages.push({ role: 'assistant', content: reply });
        break;
      }
      if (!reply) return;

      sendToClient(clientWs, { type: 'transcript', role: 'interviewer', text: reply });
      appendTranscript(sessionId, { role: 'interviewer', text: reply, timestamp: new Date() })
        .catch((e) => console.error('appendTranscript (interviewer) failed:', e));

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
      console.error('Consulting interviewer turn failed:', err);
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
    sendToClient(clientWs, { type: 'transcript', role: 'candidate', text });
    appendTranscript(sessionId, { role: 'candidate', text, timestamp: new Date() })
      .catch((e) => console.error('appendTranscript (candidate) failed:', e));
    void runInterviewerTurn(text);
  });

  stt.on('error', (message: string) => { console.error('Consulting STT error:', message); sendToClient(clientWs, { type: 'error', message }); });
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
    settleSession(sessionId).catch((e) => console.error('settleSession (consulting ws close) failed:', e));
  });
  clientWs.on('error', (err: Error) => { console.error('Consulting client WS error:', err.message); cleanup(); });
}

function sendToClient(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
