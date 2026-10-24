import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { Session } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { handlePmPipeline } from './pm/pm.pipeline.js';
import { handleConsultingPipeline } from './pm/consulting.pipeline.js';
import { handleGuesstimatePipeline } from './pm/guesstimate.pipeline.js';
import { handleResumeRealtime } from './realtime/resume.realtime.js';

// Every module now runs on the STT→LLM→TTS pipeline (OpenAI transcription +
// gpt-4o + ElevenLabs). The all-in-one Realtime voice model was retired here in
// favour of one consistent, controllable path across consulting / product /
// guesstimate. Provider/model selection lives inside the pipeline modules.

function param(req: IncomingMessage, name: string): string | null {
  return new URL(req.url ?? '', `http://${req.headers.host}`).searchParams.get(name);
}

function verifyToken(token: string): string | null {
  try {
    return (jwt.verify(token, env.JWT_SECRET) as { userId: string }).userId;
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
  // ── Auth ──
  const token = param(req, 'token');
  if (!token) { clientWs.close(4001, 'Missing token'); return; }
  const userId = verifyToken(token);
  if (!userId) { clientWs.close(4001, 'Invalid token'); return; }

  // ── Load session + case ──
  const sessionId = param(req, 'sessionId');
  if (!sessionId) { clientWs.close(4002, 'Missing session ID'); return; }

  const session = await Session.findOne({ _id: sessionId, userId }).populate('caseId');
  if (!session) { clientWs.close(4003, 'Session not found'); return; }
  if (session.status !== 'active') { clientWs.close(4004, 'Session is not active'); return; }

  const caseDoc = session.caseId as unknown as InstanceType<typeof Case> | null;
  if (!caseDoc) { clientWs.close(4005, 'Case not found'); return; }

  // ── Provider keys: fail at connect, not mid-interview ──
  if (!env.OPENAI_API_KEY) {
    sendToClient(clientWs, { type: 'error', message: 'OPENAI_API_KEY is not configured on the server' });
    clientWs.close();
    return;
  }

  const minutes = session.reservedMinutes && session.reservedMinutes > 0
    ? session.reservedMinutes
    : (session.config.durationMinutes || 45);
  const style = session.config.interviewerStyle;

  // ── Route to the module's pipeline ──
  const args = { clientWs, session, caseDoc, sessionId, minutes, style };
  // Resume interviews run on the OpenAI Realtime API (no ElevenLabs).
  if (caseDoc.module === 'resume') {
    handleResumeRealtime(args);
    return;
  }
  // The pipeline modules below voice the interviewer with ElevenLabs.
  if (!env.ELEVENLABS_API_KEY) {
    sendToClient(clientWs, { type: 'error', message: 'ELEVENLABS_API_KEY is not configured on the server' });
    clientWs.close();
    return;
  }
  if (caseDoc.module === 'product') {
    handlePmPipeline(args);
  } else if (caseDoc.module === 'guesstimate') {
    handleGuesstimatePipeline(args);
  } else {
    handleConsultingPipeline(args); // 'case' and any other module fall here
  }
}

function sendToClient(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
