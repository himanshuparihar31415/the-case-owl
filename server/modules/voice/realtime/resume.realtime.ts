import { WebSocket } from 'ws';
import { env } from '../../../config/env.js';
import { RESUME_INTERVIEWER_PROMPT, ResumeBrief } from '../../../ai/prompts.js';
import { appendTranscript, settleSession } from '../../sessions/session.service.js';
import { getInterviewContextStore, ContextTurn, StoredInterviewContext } from '../../interviewContext/context.store.js';
import { Case } from '../../../models/Case.js';
import { Session } from '../../../models/Session.js';
import {
  Asking, Directive, DirectorState, coverage, decide, directiveText, initDirector,
} from '../../resume/resume.director.js';
import { buildEndFeedback, evaluateAnswer, measureDelivery } from '../../resume/resume.evaluator.js';
import { StoredEval, evalDigest } from '../../resume/resume.scoring.js';

// RESUME-BASED interview on the OpenAI Realtime API (gpt-realtime-2): one
// speech-to-speech model hears the candidate and answers in voice, with server VAD
// owning turn-taking and barge-in. No separate STT / LLM / TTS hops.
//
// RESUME-001: the model no longer decides on its own what to ask next. After every
// candidate answer the server (1) silently evaluates it, (2) lets the director
// (resume.director.ts) update the coverage / follow-up ledger and pick the next move,
// and (3) injects that move as a private note before triggering the reply. Auto-reply
// is therefore OFF (create_response:false); this file is the only thing that starts a
// response. Nothing about the evaluation is voiced except an off-topic redirect, and
// the consolidated feedback is delivered once, at the close.
//
// Wire protocol to the browser is unchanged (session_ready, audio_chunk,
// speech_started, transcript_delta/transcript, session_ended, error; client sends
// audio_live, audio_chunk, end_session), so the client hook is the same.
//
// All interview context (instructions, setup, resume brief, every turn, evaluations,
// the director's ledger, connection events) is written through the InterviewContextStore,
// and replayed into the model / restored if the candidate reconnects mid-interview.

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
const EVAL_TIMEOUT_MS = 3500;       // past this the turn proceeds on a neutral evaluation
const FEEDBACK_TIMEOUT_MS = 15000;  // closing feedback build
const WATCHDOG_MS = 6000;           // answer heard but never answered (e.g. a noise blip split it)
const MAX_UPSTREAM_RETRIES = 5;     // mid-interview reconnects to the provider before giving up
const END_LINGER_MS = 2500;        // let the last audio flush before closing the sockets

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
  const domain = brief.domain?.trim() ?? '';
  const totalSec = minutes * 60;
  const startedMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const instructions = RESUME_INTERVIEWER_PROMPT({ brief, role, topics, interviewerStyle: style, durationMinutes: minutes });

  // Turns already saved for this interview => this is a reconnect, not a fresh start.
  const stored = (session as unknown as { interviewContext?: StoredInterviewContext }).interviewContext;
  const prior = stored?.turns ?? [];
  let isReconnect = prior.length > 0;

  // The director's ledger and the evaluations survive a reconnect.
  const director: DirectorState = (stored?.director as DirectorState | undefined) ?? initDirector(brief, topics, minutes);
  const evals: StoredEval[] = ((stored?.evals as StoredEval[] | undefined) ?? []).slice();
  let answerSeq = evals.reduce((m, e) => Math.max(m, e.answerId), 0);
  const convo: Array<{ role: string; text: string }> = prior.map((t) => ({ role: t.role, text: t.text }));
  let lastQuestion = [...prior].reverse().find((t) => t.role === 'interviewer')?.text ?? '';

  // The upstream socket can drop mid-interview (network, proxy, provider); connectUpstream()
  // re-creates it and the interview carries on from the in-memory state.
  let openaiWs: WebSocket;
  let upstreamRetries = 0;
  let upstreamRetrying = false; // the current socket is a replacement, not the first
  let upstreamOpenedAt = 0;

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

  // ── Per-answer working state ──
  let segments: string[] = [];          // transcript pieces of the answer being given (VAD may split one answer)
  let speakSec = 0;                     // measured speaking time across those pieces
  let firstSpeechAt: number | null = null;
  let lastInterviewerDoneAt = Date.now();
  let speaking = false;                 // candidate audio is live right now
  let turnToken = 0;                    // bumps on every speech start; an evaluation from an older token is stale
  let pendingAnswer = false;            // an answer is waiting for a reply it has not yet got
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let closingStarted = false;           // the close directive has been decided (feedback may still be building)
  let closeSpoken = false;              // the closing turn has been requested from the model
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  const speechStartedAt = new Map<string, number>();
  const speechSeconds = new Map<string, number>();

  const sendClient = (payload: object): void => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
  };
  const sendOpenai = (payload: object): void => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(JSON.stringify(payload));
  };

  // Auto-reply is off: the server starts every response. Barge-in stays on, except while
  // the closing feedback is being spoken.
  const turnDetection = (interrupt: boolean) => ({
    type: 'server_vad',
    threshold: 0.63,
    prefix_padding_ms: 400,
    // Room to think mid-answer before the interviewer takes the turn.
    silence_duration_ms: 1330,
    create_response: false,
    // Barge-in: candidate speech cancels the interviewer's turn (headphones assumed).
    interrupt_response: interrupt,
  });

  // Persist a turn to both the transcript (report input) and the interview context.
  const saveTurn = (turnRole: ContextTurn['role'], text: string): void => {
    const at = new Date();
    convo.push({ role: turnRole, text });
    appendTranscript(sessionId, { role: turnRole, text, timestamp: at })
      .catch((e) => console.error(`appendTranscript (${turnRole}) failed:`, e));
    track(store.appendTurn(sessionId, { role: turnRole, text, at: at.toISOString() }), `turn:${turnRole}`);
  };

  // Rebuild the conversation inside a fresh Realtime session from the stored turns.
  const replayPriorTurns = (): void => {
    for (const t of convo.slice(-MAX_REPLAY_TURNS)) {
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

  // Inject a private note, then ask the model to speak.
  const speak = (note: string): void => {
    sendOpenai({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: note }] },
    });
    sendOpenai({ type: 'response.create' });
  };

  const clearWatchdog = (): void => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

  const closeInterview = async (): Promise<void> => {
    if (closingStarted) return;
    closingStarted = true;
    // Do not let the candidate's "thank you" cut the feedback off mid-sentence.
    sendOpenai({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: turnDetection(false) } } } });
    const cov = coverage(director);
    const fb = await Promise.race([
      buildEndFeedback({
        role, domain, transcript: convo, style,
        evalDigest: evalDigest(evals, director),
        coverageLine: `${cov.covered} of ${cov.total} resume entries covered (${Math.round(cov.pct * 100)}%)`,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FEEDBACK_TIMEOUT_MS)),
    ]);
    if (fb) track(store.saveEndFeedback(sessionId, fb), 'endFeedback');
    event('closing', `coverage=${Math.round(cov.pct * 100)}% feedback=${fb ? 'yes' : 'no'}`);
    closeSpoken = true; // from here, the next response.done is the closing turn finishing
    speak(directiveText({ kind: 'close' }, {
      brief, role, domain, lastQuestion, note: '',
      feedback: fb ? `Say it in your own natural words, roughly: ${fb.spoken}` : undefined,
    }));
    // Safety net: if the closing turn never completes, still end the session.
    endTimer = setTimeout(() => shutdownAfterClose(), 90000);
  };

  const shutdownAfterClose = (): void => {
    if (closing) return;
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    setTimeout(() => shutdown('interview_complete'), END_LINGER_MS);
  };

  // Evaluate the answer given so far, update the ledger, and tell the model what to do next.
  const processAnswer = async (): Promise<void> => {
    if (closing || closingStarted || segments.length === 0) { pendingAnswer = false; return; }
    const token = turnToken;
    const answer = segments.join(' ').trim();
    const asking: Asking = director.asking;
    const entry = asking.kind === 'entry' ? director.entries[asking.entry] : undefined;
    const latency = firstSpeechAt === null ? null : Math.max(0, (firstSpeechAt - lastInterviewerDoneAt) / 1000);
    const delivery = measureDelivery(answer, speakSec, latency);

    const ev = await evaluateAnswer({
      brief, role, domain, asking, followups: entry?.followups ?? 0, question: lastQuestion, answer, delivery,
    }, EVAL_TIMEOUT_MS);

    // More speech started while we were evaluating: that answer is not finished. The
    // next transcript re-evaluates the joined text; the watchdog covers a false start.
    if (token !== turnToken || speaking || closing || closingStarted) { pendingAnswer = true; return; }

    answerSeq += 1;
    const row: StoredEval = {
      ...ev, answerId: answerSeq, at: new Date().toISOString(),
      kind: asking.kind, entryId: asking.kind === 'entry' ? asking.entry : null, followupCount: entry?.followups ?? 0,
    };
    evals.push(row);
    track(store.appendEval(sessionId, row), 'eval');

    const decision: Directive = decide(director, ev, {
      elapsedSec: (Date.now() - startedMs) / 1000, totalSec,
    });
    track(store.saveDirector(sessionId, director), 'director');
    event('directive', `${decision.kind} cov=${Math.round(coverage(director).pct * 100)}%`);
    log(`answer#${answerSeq} ${asking.kind} → ${decision.kind}${ev.fallback ? ' (fallback eval)' : ''}`);

    segments = [];
    speakSec = 0;
    firstSpeechAt = null;
    pendingAnswer = false;
    clearWatchdog();

    if (decision.kind === 'close') { await closeInterview(); return; }
    speak(directiveText(decision, { brief, role, domain, lastQuestion, note: ev.note }));
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
    clearWatchdog();
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    track(store.finalize(sessionId, reason), 'finalize');
    try { openaiWs.close(); } catch { /* noop */ }
  }

  // ── OpenAI side ──
  function connectUpstream(): void {
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`,
    { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
  );
  openaiWs = ws;

  ws.on('open', () => {
    if (ws !== openaiWs) return;
    clearTimeout(connectTimeout);
    openaiReady = true;
    upstreamOpenedAt = Date.now();
    log(`connected (${env.OPENAI_REALTIME_MODEL}${isReconnect ? `, replaying ${Math.min(prior.length, MAX_REPLAY_TURNS)} turns` : ''})`);

    track(store.init(sessionId, {
      module: 'resume',
      model: env.OPENAI_REALTIME_MODEL,
      instructions,
      setup: { role, topics, style, durationMinutes: minutes, domain },
      brief,
    }), 'init');
    track(store.saveDirector(sessionId, director), 'director');
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
            turn_detection: turnDetection(true),
          },
          output: { format: { type: 'audio/pcm', rate: 24000 }, voice: env.OPENAI_REALTIME_VOICE },
        },
      },
    });
  });

  ws.on('message', (data: Buffer) => {
    if (ws !== openaiWs) return;
    let ev: Record<string, any>;
    try { ev = JSON.parse(data.toString()); } catch { return; }

    switch (ev.type) {
      case 'session.updated':
        // session.updated can arrive more than once; configure + announce only once.
        if (readySent) break;
        readySent = true;
        if (isReconnect) replayPriorTurns();
        if (upstreamRetrying) {
          // The browser is still connected and live: no new session_ready, just pick the thread back up.
          upstreamRetrying = false;
          greeted = false;
          fireGreeting();
          break;
        }
        sendClient({ type: 'session_ready' });
        // Fallback so we never hang silent if the client never confirms audio_live.
        greetTimer = setTimeout(fireGreeting, 4000);
        break;

      case 'input_audio_buffer.speech_started':
        speaking = true;
        turnToken += 1;
        if (firstSpeechAt === null) firstSpeechAt = Date.now();
        if (ev.item_id) speechStartedAt.set(String(ev.item_id), Date.now());
        // Never interrupt the closing feedback on the client side either.
        if (!closingStarted) sendClient({ type: 'speech_started' });
        break;

      case 'input_audio_buffer.speech_stopped': {
        speaking = false;
        const id = ev.item_id ? String(ev.item_id) : '';
        const began = id ? speechStartedAt.get(id) : undefined;
        if (id && began) speechSeconds.set(id, (Date.now() - began) / 1000);
        // If the transcript or reply never follows (a noise blip split the answer), pick it up.
        clearWatchdog();
        watchdog = setTimeout(() => { if (pendingAnswer) void processAnswer(); }, WATCHDOG_MS);
        break;
      }

      case 'response.created':
        pendingAnswer = false;
        clearWatchdog();
        break;

      case 'response.done':
        lastInterviewerDoneAt = Date.now();
        if (closeSpoken) shutdownAfterClose();
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
        if (!closingStarted) lastQuestion = ev.transcript;
        greetingDone = true; // first AI turn finished; accept candidate audio
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (!ev.transcript || !String(ev.transcript).trim()) break;
        const text = String(ev.transcript).trim();
        sendClient({ type: 'transcript', role: 'candidate', text });
        saveTurn('candidate', text);
        if (closingStarted) break;
        segments.push(text);
        speakSec += speechSeconds.get(String(ev.item_id ?? '')) ?? 0;
        pendingAnswer = true;
        void processAnswer();
        break;
      }

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

  ws.on('error', (err) => {
    if (ws !== openaiWs) return;
    console.error('Resume realtime WS error:', err);
    event('openai_socket_error', String(err?.message ?? err).slice(0, 300));
    // Once the interview is live a drop is retried quietly; only a failure to connect is shown.
    if (!openaiReady && !closing) sendClient({ type: 'error', message: `Voice service connection error: ${String(err?.message ?? err)}` });
  });

  ws.on('close', (code, reason) => {
    if (ws !== openaiWs) return;
    const why = reason?.toString?.() ?? '';
    const upSec = upstreamOpenedAt ? Math.round((Date.now() - upstreamOpenedAt) / 1000) : 0;
    log(`openai closed ${code} ${why} after ${upSec}s`);
    const wasLive = openaiReady;
    openaiReady = false;

    // Dropped mid-interview (not by us, not by the closing turn): reconnect and carry on.
    if (!closing && !closeSpoken && wasLive && upstreamRetries < MAX_UPSTREAM_RETRIES && clientWs.readyState === WebSocket.OPEN) {
      upstreamRetries += 1;
      event('upstream_reconnect', `code=${code} after=${upSec}s attempt=${upstreamRetries}`);
      log(`upstream dropped, reconnecting (attempt ${upstreamRetries}/${MAX_UPSTREAM_RETRIES})`);
      readySent = false;
      upstreamRetrying = true;
      isReconnect = convo.length > 0;
      // The half-heard answer is already saved in the transcript and replayed; start clean.
      segments = []; speakSec = 0; firstSpeechAt = null; speaking = false; pendingAnswer = false;
      clearWatchdog();
      setTimeout(() => { if (!closing) connectUpstream(); }, 600 * upstreamRetries);
      return;
    }

    if (!closing) {
      event('openai_closed', `${code} ${why}`.trim());
      sendClient({ type: 'error', message: `AI connection closed (code=${code})${why ? `: ${why}` : ''}` });
    }
    clearTimeout(capTimer);
    clearTimeout(connectTimeout);
    clearWatchdog();
    if (endTimer) clearTimeout(endTimer);
    if (greetTimer) clearTimeout(greetTimer);
    sendClient({ type: 'session_ended' });
    try { clientWs.close(); } catch { /* noop */ }
  });
  }
  connectUpstream();

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
    // Turn-taking and barge-in are owned by server VAD; replies are started only by
    // processAnswer() / the greeting (create_response is off), so nothing double-speaks.
  });

  clientWs.on('close', () => {
    shutdown(closing ? 'closed' : 'client_disconnected');
    settleSession(sessionId).catch((e) => console.error('settleSession (resume realtime ws close) failed:', e));
  });
  clientWs.on('error', (err: Error) => { console.error('Resume realtime client WS error:', err.message); shutdown('client_error'); });
}
