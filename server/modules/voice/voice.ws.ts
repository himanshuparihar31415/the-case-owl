import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import WebSocketNode from 'ws';
import { env } from '../../config/env.js';
import { Session } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { INTERVIEWER_SYSTEM_PROMPT } from '../../ai/prompts.js';
import { appendTranscript, settleSession } from '../sessions/session.service.js';
import { CaseType } from '../../models/Case.js';
import { buildForbiddenList, deterministicCheck } from './supervisor.js';

// gpt-4o-realtime-preview-* were all shut down 2026-05-07. gpt-realtime-2 (released
// 2026-05-07) is the current top realtime voice model — GPT-5-class reasoning,
// stronger instruction-following. Same Realtime API, so the session schema below
// is unchanged. Fall back to gpt-realtime if you ever need to cut cost/latency.
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2';

function extractToken(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  return url.searchParams.get('token');
}

function extractSessionId(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  return url.searchParams.get('sessionId');
}

function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    return payload.userId;
  } catch {
    return null;
  }
}

export function setupVoiceWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    handleConnection(clientWs, req).catch((err) => {
      console.error('Voice WS unhandled error:', err);
      sendToClient(clientWs, { type: 'error', message: String(err?.message ?? 'Internal voice service error') });
      clientWs.close(4000, String(err?.message ?? 'Internal error').slice(0, 123));
    });
  });
}

async function handleConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    // Authenticate
    const token = extractToken(req);
    if (!token) {
      clientWs.close(4001, 'Missing token');
      return;
    }

    const userId = verifyToken(token);
    if (!userId) {
      clientWs.close(4001, 'Invalid token');
      return;
    }

    // Load session and case
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      clientWs.close(4002, 'Missing session ID');
      return;
    }

    const session = await Session.findOne({ _id: sessionId, userId }).populate('caseId');
    if (!session) {
      clientWs.close(4003, 'Session not found');
      return;
    }

    if (session.status !== 'active') {
      clientWs.close(4004, 'Session is not active');
      return;
    }

    // Fix 2: null-check caseDoc in case the referenced Case was deleted
    const caseDoc = session.caseId as unknown as InstanceType<typeof Case> | null;
    if (!caseDoc) {
      clientWs.close(4005, 'Case not found');
      return;
    }

    // Build system prompt
    const systemPrompt = INTERVIEWER_SYSTEM_PROMPT(
      caseDoc.title,
      caseDoc.scenario,
      caseDoc.keyDataPoints,
      caseDoc.type as CaseType,
      session.config.difficulty,
      session.config.interviewerStyle,
      session.reservedMinutes && session.reservedMinutes > 0
        ? session.reservedMinutes
        : (session.config.durationMinutes || 45),
      caseDoc.plausibleSolution,
      caseDoc.openingHook,
      // Pharma-profitability exhibit cases: hand the interviewer the exhibits to
      // release only when earned, the quant task, and the private mechanism.
      (caseDoc.exhibits && caseDoc.exhibits.length)
        ? { exhibits: caseDoc.exhibits, quant: caseDoc.quant, privateMechanism: caseDoc.privateMechanismNote }
        : undefined
    );

    // Fail fast if no API key configured
    if (!env.OPENAI_API_KEY) {
      sendToClient(clientWs, { type: 'error', message: 'OPENAI_API_KEY is not configured on the server' });
      clientWs.close();
      return;
    }

    // Connect to OpenAI Realtime API
    const openaiWs = new WebSocketNode(OPENAI_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        // GA Realtime interface no longer uses the OpenAI-Beta header.
      },
    });

    // Silent supervisor (observe-only for now): flags leading / fed-data per turn.
    const forbidden = buildForbiddenList(caseDoc);
    const candidateHistory: string[] = [];
    const flaggedTerms = new Set<string>(); // dedupe: flag each term once per session
    // GA Realtime emits BOTH the namespaced (response.output_audio_transcript.done)
    // AND the legacy (response.audio_transcript.done) event for the SAME turn. Our
    // case fall-through would then save/send that turn twice — the "double message"
    // bug. Dedupe by item_id so each conversation item is processed exactly once.
    const processedItems = new Set<string>();
    // Same dual-emit applies to the streaming deltas (audio + transcript). Lock to
    // the first event type we see and ignore the parallel stream, else audio plays
    // twice (garbled) and the live transcript shows every word doubled.
    let audioDeltaType: string | null = null;
    let transcriptDeltaType: string | null = null;
    // Don't forward candidate audio to OpenAI until the greeting turn finishes —
    // otherwise the AI's own opening (echo) or mic-startup noise false-triggers
    // VAD, interrupts the greeting, and spawns phantom "Got it." turns.
    let greetingDone = false;

    let openaiReady = false;
    // Guard: the AI greeting must fire EXACTLY once. `session.updated` can be
    // emitted more than once (and we may send session.update again later), and
    // each one would otherwise trigger another response.create → the "two
    // greetings at 00:00" double-message bug.
    let greeted = false;
    // We deliberately DON'T greet the moment the session is configured. If the
    // AI speaks before the candidate's mic/speaker pipeline is live, its first
    // line ("Hey, can you hear me okay?") plays into a dead pipeline and gets
    // clipped (the 00:00 bug). We wait for the client to confirm audio is live
    // (audio_live), then fire the greeting. greetTimer is a fallback in case the
    // client never confirms (mic denied / slow getUserMedia) so we don't hang silent.
    let greetTimer: ReturnType<typeof setTimeout> | null = null;
    const fireGreeting = (): void => {
      if (greeted || openaiWs.readyState !== WebSocketNode.OPEN) return;
      greeted = true;
      if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    };

    // HARD STOP (non-negotiable guardrail): kill the session when it reaches the
    // minutes reserved for it (bounded by the plan's per-interview cap). This is
    // server-side and never trusts the client — it's what stops a runaway voice
    // session from burning unbounded API cost.
    const capMinutes = session.reservedMinutes && session.reservedMinutes > 0
      ? session.reservedMinutes
      : (session.config.durationMinutes || 45); // align with the prompt-builder fallback
    const capTimer = setTimeout(() => {
      sendToClient(clientWs, { type: 'error', message: `Time limit reached (${capMinutes} min). Wrapping up your session.` });
      sendToClient(clientWs, { type: 'session_ended' });
      try { openaiWs.close(); } catch { /* noop */ }
      try { clientWs.close(4008, 'Time cap reached'); } catch { /* noop */ }
    }, capMinutes * 60 * 1000);

    // Fix 3: timeout if OpenAI never responds
    const openaiTimeout = setTimeout(() => {
      if (!openaiReady) {
        sendToClient(clientWs, { type: 'error', message: 'AI service connection timed out' });
        openaiWs.terminate();
        clientWs.close(4006, 'AI connection timeout');
      }
    }, 10000);

    openaiWs.on('open', () => {
      clearTimeout(openaiTimeout);
      openaiReady = true;

      // Configure the session — GA Realtime schema: nested audio config,
      // output_modalities instead of modalities.
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: systemPrompt,
          // NOTE: the GA Realtime session schema does not accept a top-level
          // `temperature` — sending it makes OpenAI reject the whole
          // session.update. Steer consistency via the prompt instead.
          // Reasoning effort for gpt-realtime-2 (minimal|low|medium|high|xhigh;
          // default low). 'medium' keeps it sharp but less verbose than 'high'
          // (high tended to pack 2-3 questions + long sentences into one turn).
          reasoning: { effort: 'medium' },
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              // gpt-realtime-whisper: the streaming STT released with gpt-realtime-2;
              // better candidate transcripts than the old whisper-1 (bad transcription
              // is itself a "not listening" failure mode).
              transcription: { model: 'gpt-realtime-whisper' },
              turn_detection: {
                // server_vad gives explicit knobs (threshold + silence_duration);
                // semantic_vad felt erratic for this app.
                type: 'server_vad',
                threshold: 0.63,
                // prefix_padding = how much audio BEFORE speech onset is kept.
                // Keep it small (200-500ms); high values fold trailing AI audio /
                // room noise into the candidate's turn. (1000 was too high.)
                prefix_padding_ms: 400,
                // 1330ms of silence before taking a turn — gives candidates room
                // to think mid-answer instead of firing into a thinking pause.
                silence_duration_ms: 1330,
                create_response: true,
                // Candidate barge-in: when they start talking, cancel the AI's turn
                // and respond to them. Safe because users are on headphones — no
                // speaker echo to false-trigger it. (If we ever support speakers,
                // this is the flag that lets echo recreate a turn; the GA dual-event
                // dedup below still guards the OTHER double-message source.)
                interrupt_response: true,
              },
            },
            output: {
              format: { type: 'audio/pcm', rate: 24000 },
              voice: 'cedar',
            },
          },
        },
      };

      openaiWs.send(JSON.stringify(sessionUpdate));
    });

    // Forward OpenAI events to client
    openaiWs.on('message', async (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());

        switch (event.type) {
          case 'session.updated':
            // Session is configured — tell the client to bring its audio pipeline
            // up. We do NOT greet here; we wait for the client's audio_live
            // confirmation so the AI's first words land in a live pipeline (see
            // fireGreeting). Fallback-greet after 4s if the client never confirms.
            sendToClient(clientWs, { type: 'session_ready' });
            if (!greetTimer && !greeted) greetTimer = setTimeout(fireGreeting, 4000);
            break;

          case 'input_audio_buffer.speech_started':
            // Candidate started talking — tell the client to stop playing any
            // buffered AI audio immediately so the AI doesn't talk over them.
            sendToClient(clientWs, { type: 'speech_started' });
            break;
          // GA emits response.output_audio.delta; some snapshots still emit
          // the legacy response.audio.delta — accept both.
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            // Stream AI audio chunk to client (ignore the parallel dual-emit stream).
            if (audioDeltaType === null) audioDeltaType = event.type;
            if (event.type !== audioDeltaType) break;
            sendToClient(clientWs, {
              type: 'audio_chunk',
              data: event.delta,
            });
            break;

          case 'response.output_audio_transcript.delta':
          case 'response.audio_transcript.delta':
            // Partial AI transcript — forward for live display (ignore the dual-emit stream).
            if (transcriptDeltaType === null) transcriptDeltaType = event.type;
            if (event.type !== transcriptDeltaType) break;
            sendToClient(clientWs, {
              type: 'transcript_delta',
              role: 'interviewer',
              text: event.delta,
            });
            break;

          case 'response.output_audio_transcript.done':
          case 'response.audio_transcript.done':
            // Final AI transcript turn — save to DB. Guard against the GA dual-event
            // emit (namespaced + legacy for the same item) doubling the turn.
            if (event.transcript) {
              const itemKey = String(event.item_id ?? event.response_id ?? '');
              if (itemKey && processedItems.has(itemKey)) break;
              if (itemKey) processedItems.add(itemKey);
              sendToClient(clientWs, {
                type: 'transcript',
                role: 'interviewer',
                text: event.transcript,
              });
              // Supervisor (observe-only): flag if the interviewer led or fed data.
              const check = deterministicCheck(event.transcript, candidateHistory, forbidden);
              if (check.verdict !== 'OK' && check.term && !flaggedTerms.has(check.term)) {
                flaggedTerms.add(check.term); // each term flagged once per session
                console.warn(`[supervisor] session=${sessionId} ${check.verdict} term="${check.term}"`);
                // Persist for the admin compliance block in the report (fire-and-forget).
                Session.updateOne(
                  { _id: sessionId },
                  { $push: { supervisorFlags: { verdict: check.verdict, term: check.term, at: new Date().toISOString() } } }
                ).catch((e) => console.error('supervisorFlags persist failed:', e));
              }
              // First interviewer turn = the greeting; now accept candidate audio.
              greetingDone = true;
              // Fix 1: don't let DB errors crash the WS handler
              await appendTranscript(sessionId, {
                role: 'interviewer',
                text: event.transcript,
                timestamp: new Date(),
              }).catch((e) => console.error('appendTranscript (interviewer) failed:', e));
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            // Candidate speech transcribed — save and display
            if (event.transcript) {
              candidateHistory.push(event.transcript); // supervisor: what they've earned
              sendToClient(clientWs, {
                type: 'transcript',
                role: 'candidate',
                text: event.transcript,
              });
              // Fix 1: don't let DB errors crash the WS handler
              await appendTranscript(sessionId, {
                role: 'candidate',
                text: event.transcript,
                timestamp: new Date(),
              }).catch((e) => console.error('appendTranscript (candidate) failed:', e));
            }
            break;

          case 'error':
            sendToClient(clientWs, { type: 'error', message: event.error?.message ?? 'OpenAI error' });
            break;

          default:
            break;
        }
      } catch {
        // ignore parse errors on non-JSON messages
      }
    });

    openaiWs.on('error', (err) => {
      console.error('OpenAI WS error:', err);
      sendToClient(clientWs, { type: 'error', message: `Voice service connection error: ${String(err?.message ?? err)}` });
    });

    openaiWs.on('close', (code, reason) => {
      clearTimeout(capTimer);
      if (greetTimer) clearTimeout(greetTimer);
      console.error('OpenAI WS closed:', code, reason?.toString?.() ?? reason);
      sendToClient(clientWs, { type: 'error', message: `AI connection closed (code=${code}): ${reason?.toString?.() ?? ''}` });
      sendToClient(clientWs, { type: 'session_ended' });
      // Close the client WS if it's still open
      try {
        clientWs.close();
      } catch (e) {
        console.error('Error closing client WS after OpenAI close:', e);
      }
    });

    // Handle messages from the client (browser)
    clientWs.on('message', (data: Buffer) => {
      if (!openaiReady) return;

      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'audio_live') {
          // Client's mic + speaker pipeline is confirmed live. NOW fire the AI's
          // first turn ("Hey, can you hear me okay?") so it lands in a live
          // pipeline instead of getting clipped at 00:00.
          fireGreeting();
        } else if (message.type === 'audio_chunk') {
          // Drop candidate audio only until the greeting finishes (keeps startup
          // mic noise from triggering a phantom turn). After that the mic stays
          // open so the candidate can barge in — they're on headphones, no echo.
          if (!greetingDone) return;
          // Forward audio to OpenAI
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: message.data,
          };
          openaiWs.send(JSON.stringify(audioAppend));
        } else if (message.type === 'end_session') {
          openaiWs.close();
          clientWs.close();
        }
        // NOTE: server_vad owns turn-taking (create_response) AND barge-in
        // (interrupt_response). We deliberately do NOT handle manual 'audio_commit'
        // or 'interrupt' here — committing/creating a response ourselves would
        // produce a SECOND response for the same turn (the double-speak bug). The
        // browser only sends audio_chunk + end_session; the server drives turns.
      } catch {
        // Handle raw binary audio (PCM16 directly)
        if (Buffer.isBuffer(data) && openaiReady && greetingDone) {
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.toString('base64'),
          };
          openaiWs.send(JSON.stringify(audioAppend));
        }
      }
    });

    clientWs.on('close', () => {
      clearTimeout(capTimer);
      if (greetTimer) clearTimeout(greetTimer);
      if (openaiWs.readyState === WebSocketNode.OPEN) {
        openaiWs.close();
      }
      // Settle credits even if the candidate abandoned without "Stop & Submit".
      // Idempotent — a later endSession call won't double-charge.
      settleSession(sessionId).catch((e) => console.error('settleSession (ws close) failed:', e));
    });

    clientWs.on('error', (err) => {
      console.error('Client WS error:', err.message);
      clearTimeout(capTimer);
      openaiWs.close();
    });
}

function sendToClient(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
