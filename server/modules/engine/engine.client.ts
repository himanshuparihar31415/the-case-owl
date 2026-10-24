// Node → interview engine (docs/engine-contract.md, section 1). The engine is a separate service
// (engine/, deployed at ENGINE_URL); Node brokers calls for sessions routed to it and settles them.
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface EngineUi {
  url: string;
  token: string;
  expiresAt: string;
}

export interface EngineCall {
  callId: string;
  sdpAnswer: string;
  ui: EngineUi;
}

export interface EngineTranscriptEntry {
  role: 'interviewer' | 'candidate';
  text: string;
  timestamp: string;
}

/** The settle payload: the same shape whether the engine pushes it or Node fetches it. */
export interface EngineSettlement {
  callId: string;
  endedReason: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  transcript: EngineTranscriptEntry[];
  summary: {
    stageReached: string;
    factsReleased: string[];
    hintsUsed: number;
    guardHits: number;
    costUsd: number;
  };
}

export interface CreateEngineCall {
  sessionId: string;
  userId: string;
  caseId: string;
  sdpOffer: string;
  maxMinutes: number;
  candidateFirstName?: string;
}

interface EngineErrorBody {
  error?: { code?: string; message?: string };
}

const TIMEOUT_MS = 15_000;
// The engine answers these while an interview moves between instances (a deploy): retry shortly.
const RETRYABLE = new Set(['call_moving', 'draining']);

/** The engine already has a live call for this session (a second request while the first was in flight). */
export class EngineCallExists extends Error {}

export function engineConfigured(): boolean {
  return Boolean(env.ENGINE_URL && env.ENGINE_SERVICE_TOKEN);
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T & EngineErrorBody }> {
  if (!engineConfigured()) throw new AppError(503, 'The interview engine is not configured');
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${env.ENGINE_URL!.replace(/\/$/, '')}${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.ENGINE_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`engine ${method} ${path} failed:`, (err as Error).message);
      throw new AppError(502, 'The interview engine is unreachable. Please try again.');
    }
    const data = (await res.json().catch(() => ({}))) as T & EngineErrorBody;
    const code = data.error?.code;
    if (res.status === 503 && code && RETRYABLE.has(code) && attempt < 10) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    return { status: res.status, data };
  }
}

/** Map an engine error to what the user should see; misconfiguration is logged, not shown. */
function fail(status: number, body: EngineErrorBody): never {
  const code = body.error?.code ?? 'engine_error';
  const message = body.error?.message ?? `Engine error ${status}`;
  if (status === 401) {
    console.error('engine rejected the service token: check ENGINE_SERVICE_TOKEN');
    throw new AppError(500, 'The interview could not be started.');
  }
  if (code === 'at_capacity') throw new AppError(429, 'The interviewer is busy right now. Try again in a minute.');
  if (code === 'case_not_ready') throw new AppError(409, 'This case is not available for the new interviewer yet.');
  if (code === 'upstream_unavailable') throw new AppError(502, 'The voice service did not respond. Please try again.');
  throw new AppError(status >= 500 ? 502 : status, message);
}

export async function createEngineCall(input: CreateEngineCall): Promise<EngineCall> {
  const { status, data } = await request<EngineCall>('POST', '/v1/calls', {
    sessionId: input.sessionId,
    userId: input.userId,
    caseId: input.caseId,
    sdpOffer: input.sdpOffer,
    limits: { maxMinutes: input.maxMinutes },
    config: { candidateFirstName: input.candidateFirstName || undefined },
  });
  if (status === 409 && data.error?.code === 'call_exists') throw new EngineCallExists();
  if (status !== 201) fail(status, data);
  return { callId: data.callId, sdpAnswer: data.sdpAnswer, ui: data.ui };
}

/** A new audio connection for the same interview; `ui` is a fresh token for its UI socket. */
export async function reofferEngineCall(callId: string, sdpOffer: string): Promise<{ sdpAnswer: string; ui: EngineUi }> {
  const { status, data } = await request<{ sdpAnswer: string; ui: EngineUi }>('POST', `/v1/calls/${encodeURIComponent(callId)}/reoffer`, { sdpOffer });
  if (status !== 200) fail(status, data);
  return { sdpAnswer: data.sdpAnswer, ui: data.ui };
}

export async function endEngineCall(callId: string, reason: 'candidate_ended' | 'abandoned' | 'admin'): Promise<void> {
  const { status, data } = await request('POST', `/v1/calls/${encodeURIComponent(callId)}/end`, { reason });
  if (status !== 202 && status !== 404) fail(status, data);
}

/** The ended interview's settle payload, or null while it is still live (the engine says 409). */
export async function fetchEngineSettlement(callId: string): Promise<EngineSettlement | null> {
  const { status, data } = await request<EngineSettlement>('GET', `/v1/calls/${encodeURIComponent(callId)}/settlement`);
  if (status === 409) return null;
  if (status !== 200) fail(status, data);
  return data;
}
