import { WebSocket } from 'ws';
import { env } from '../../../config/env.js';
import { RESUME_INTERVIEWER_PROMPT, ResumeBrief } from '../../../ai/prompts.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { getInterviewContextStore, ContextTurn, StoredInterviewContext } from '../../interviewContext/context.store.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';

// RESUME-BASED interview on the OpenAI Realtime API (gpt-realtime-2): one
// speech-to-speech model hears the candidate and answers in voice, with server VAD
// owning turn-taking and barge-in. No separate STT / LLM / TTS hops.
//
// Wire protocol to the browser is unchanged (session_ready, audio_chunk,
// speech_started, transcript_delta/transcript, session_ended, error; client sends
// audio_live, audio_chunk, end_session), so the client hook is the same.
//
// All interview context (instructions, setup, resume brief, every turn, connection
// events) is written through the InterviewContextStore, and replayed into the
// model if the candidate's connection drops and they reconnect mid-interview.

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

const MAX_REPLAY_TURNS = 40;
const MAX_REPLAY_CHARS = 1500;

export function handleResumeRealtime(args: Args): void {
  const { clientWs, session, caseDoc, sessionId, minutes, style } = args;
  const store = getInterviewContextStore();
  const log = (msg: string): void => console.log(`[resume-rt] session=${sessionId} ${msg}`);
  const track = (p: Promise<unknown>, what: string): void => { p.catch((e) => console.error(`context ${what} failed:`, e)); };
  const event = (type: string, detail?: string): void =>
    track(store.appendEvent(sessionId, { type, at: new Date().toISOString(), detail }), `event:${type}`);

  const brief = (caseDoc.resumeBrief ?? { candidateName: '', headline: '', sections: [] }) as ResumeBrief;
  const role = caseDoc.resumeRole ?? 'Consulting';
  const topics = caseDoc.resumeTopics ?? [];
  const instructions = RESUME_INTERVIEWER_PROMPT({ brief, role, topics, interviewerStyle: style, durationMinutes: minutes });

  // Turns already saved for this interview => this is a reconnect, not a fresh start.
  const prior = ((session as unknown as { interviewContext?: StoredInterviewContext }).interviewContext?.turns ?? []);
  const isReconnect = prior.length > 0;

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`,
    { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
  );

  let openaiReady = false;      // socket open + session.update sent
  let readySent = false;        // session_ready sent to the browser (once)
  let greeted = false;          // the AI's first line fires exactly once
  let greetingDone = false;     // candidate audio is only forwarded after the first AI turn
  let greetTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;          // we initiated the shutdown
  const processedItems = new Set<string>();
  // GA Realtime may emit BOTH namespaced and legacy audio/transcript events for the
  // same data; lock to the first type seen so audio never plays twice.
  let audioDeltaType: string | null = null;
  let transcriptDeltaType: string | null = null;

  const sendClient = (payload: object): void => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
  };
  const sendOpenai = (payload: object): void => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(JSON.stringify(payload));
  };

  // Persist a turn to both the transcript (report input) and the interview context.
  const saveTurn = (role: ContextTurn['role'], text: string): void => {
    const at = new Date();
    appendTranscript(sessionId, { role, text, timestamp: at })
      .catch((e) => console.error(`appendTranscript (${role}) failed:`, e));
    track(store.appendTurn(sessionId, { role, text, at: at.toISOString() }), `turn:${role}`);
  };

  // Rebuild the conversation inside a fresh Realtime session from the stored turns.
  const replayPriorTurns = (): void => {
    for (const t of prior.slice(-MAX_REPLAY_TURNS)) {
      const text = String(t.text ?? '').slice(0, MAX_REPLAY_CHARS);
      if (!text) continue;
      sendOpenai({
        type: 'conversation.item.create',
        item: t.role === 'interviewer'
          ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
          : { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
    }
  };

  // The AI must not speak before the browser's mic + speaker pipeline is live (its
  // first words would be clipped), so we wait for the client's audio_live.
  const fireGreeting = (): void => {
    if (greeted || openaiWs.readyState !== WebSocket.OPEN) return;
    greeted = true;
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    if (isReconnect) {
      sendOpenai({
        type: 'response.create',
        response: {
          instructions: 'The connection dropped for a moment and the candidate is back. In ONE short sentence say you are back, then repeat or rephrase your last question and carry on from where you were. Do not restart the interview or re-introduce yourself.',
        },
      });
    } else {
      sendOpenai({ type: 'response.create' });
    }
    event(isReconnect ? 'greeting_reconnect' : 'greeting');
  };

  // HARD STOP: server-side time cap, never trusts the client.
  const capTimer = setTimeout(() => {
    sendClient({ type: 'error', message: `Time limit reached (${minutes} min). Wrapping up your session.` });
    sendClient({ type: 'session_ended' });
    shutdown('time_cap');
    try { clientWs.close(4008, 'Time cap reached'); } catch { /* noop */ }
  }, minutes * 60 * 1000);

  const connectTimeout = setTimeout(() => {
    if (!openaiReady) {
      sendClient({ type: 'error', message: 'AI service connection timed out' });
      try { openaiWs.terminate(); } catch { /* noop */ }
      try { clientWs.close(4006, 'AI connection timeout'); } catch { /* noop */ }
    }
  }, 10000);

  function shutdown(reason: string): void {
    if (closing) return;
    closing = true;
    clearTimeout(capTimer);
    clearTimeout(connectTimeout);
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    track(store.finalize(sessionId, reason), 'finalize');
    try { openaiWs.close(); } catch { /* noop */ }
  }

  // ── OpenAI side ──
  openaiWs.on('open', () => {
    clearTimeout(connectTimeout);
    openaiReady = true;
    log(`connected (${env.OPENAI_REALTIME_MODEL}${isReconnect ? `, replaying ${Math.min(prior.length, MAX_REPLAY_TURNS)} turns` : ''})`);

    track(store.init(sessionId, {
      module: 'resume',
      model: env.OPENAI_REALTIME_MODEL,
      instructions,
      setup: { role, topics, style, durationMinutes: minutes },
      brief,
    }), 'init');
    event(isReconnect ? 'reconnected' : 'connected');

    sendOpenai({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions,
        reasoning: { effort: env.OPENAI_REALTIME_REASONING },
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            // Streaming STT released with gpt-realtime-2: the candidate transcript the report is scored on.
            transcription: { model: 'gpt-realtime-whisper' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.63,
              prefix_padding_ms: 400,
              // Room to think mid-answer before the interviewer takes the turn.
              silence_duration_ms: 1330,
              create_response: true,
              // Barge-in: candidate speech cancels the interviewer's turn (headphones assumed).
              interrupt_response: true,
            },
          },
          output: { format: { type: 'audio/pcm', rate: 24000 }, voice: env.OPENAI_REALTIME_VOICE },
        },
      },
    });
  });

  openaiWs.on('message', (data: Buffer) => {
    let ev: Record<string, any>;
    try { ev = JSON.parse(data.toString()); } catch { return; }

    switch (ev.type) {
      case 'session.updated':
        // session.updated can arrive more than once; configure + announce only once.
        if (readySent) break;
        readySent = true;
        if (isReconnect) replayPriorTurns();
        sendClient({ type: 'session_ready' });
        // Fallback so we never hang silent if the client never confirms audio_live.
        greetTimer = setTimeout(fireGreeting, 4000);
        break;

      case 'input_audio_buffer.speech_started':
        sendClient({ type: 'speech_started' });
        break;

      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (audioDeltaType === null) audioDeltaType = ev.type;
        if (ev.type !== audioDeltaType) break;
        sendClient({ type: 'audio_chunk', data: ev.delta });
        break;

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (transcriptDeltaType === null) transcriptDeltaType = ev.type;
        if (ev.type !== transcriptDeltaType) break;
        sendClient({ type: 'transcript_delta', role: 'interviewer', text: ev.delta });
        break;

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        if (!ev.transcript) break;
        const key = String(ev.item_id ?? ev.response_id ?? '');
        if (key && processedItems.has(key)) break; // dual-emit guard
        if (key) processedItems.add(key);
        sendClient({ type: 'transcript', role: 'interviewer', text: ev.transcript });
        saveTurn('interviewer', ev.transcript);
        greetingDone = true; // first AI turn finished; accept candidate audio
        break;
      }

      case 'conversation.item.input_audio_transcription.completed':
        if (!ev.transcript || !String(ev.transcript).trim()) break;
        sendClient({ type: 'transcript', role: 'candidate', text: ev.transcript });
        saveTurn('candidate', ev.transcript);
        break;

      case 'error': {
        const message: string = ev.error?.message ?? 'OpenAI error';
        // Barge-in can race a cancel against an already-finished response; harmless.
        if (/no active response|cancellation failed/i.test(message)) break;
        console.error(`[resume-rt] session=${sessionId} OpenAI error:`, ev.error);
        event('openai_error', message.slice(0, 300));
        sendClient({ type: 'error', message });
        break;
      }

      default:
        break;
    }
  });

  openaiWs.on('error', (err) => {
    console.error('Resume realtime WS error:', err);
    event('openai_socket_error', String(err?.message ?? err).slice(0, 300));
    sendClient({ type: 'error', message: `Voice service connection error: ${String(err?.message ?? err)}` });
  });

  openaiWs.on('close', (code, reason) => {
    const why = reason?.toString?.() ?? '';
    log(`openai closed ${code} ${why}`);
    if (!closing) {
      event('openai_closed', `${code} ${why}`.trim());
      sendClient({ type: 'error', message: `AI connection closed (code=${code})${why ? `: ${why}` : ''}` });
    }
    clearTimeout(capTimer);
    clearTimeout(connectTimeout);
    if (greetTimer) clearTimeout(greetTimer);
    sendClient({ type: 'session_ended' });
    try { clientWs.close(); } catch { /* noop */ }
  });

  // ── Browser side ──
  clientWs.on('message', (data: Buffer) => {
    if (!openaiReady) return;
    let msg: Record<string, any>;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'audio_live') {
      fireGreeting();
    } else if (msg.type === 'audio_chunk') {
      // Hold candidate audio until the AI's first turn is done (startup noise would
      // otherwise trigger a phantom turn); after that the mic stays open for barge-in.
      if (!greetingDone || typeof msg.data !== 'string') return;
      sendOpenai({ type: 'input_audio_buffer.append', audio: msg.data });
    } else if (msg.type === 'end_session') {
      shutdown('client_ended');
      try { clientWs.close(); } catch { /* noop */ }
    }
    // Turn-taking and barge-in are owned by server VAD; we never commit or create
    // responses manually (that would double-speak).
  });

  clientWs.on('close', () => {
    shutdown(closing ? 'closed' : 'client_disconnected');
    settleSession(sessionId).catch((e) => console.error('settleSession (resume realtime ws close) failed:', e));
  });
  clientWs.on('error', (err: Error) => { console.error('Resume realtime client WS error:', err.message); shutdown('client_error'); });
}
