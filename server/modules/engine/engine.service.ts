// Sessions on the interview engine: which sessions go to it, and applying its settlement
// (docs/engine-contract.md, sections 2 and 4). Everything here is a no-op for other sessions.
import mongoose from 'mongoose';
import { Case, ICase } from '../../models/Case.js';
import { ISession, Session } from '../../models/Session.js';
import { getSettings } from '../../models/Setting.js';
import { settleSession } from '../sessions/session.service.js';
import {
  EngineSettlement, endEngineCall, engineConfigured, fetchEngineSettlement,
} from './engine.client.js';

/**
 * The case a new session runs on the engine, or null for today's pipeline. A consulting case goes
 * to the engine only for pilot users, while the engine is configured. During the one-case pilot the
 * pilot case replaces whatever the user picked; a case that is itself on the engine runs as chosen.
 */
export async function engineRouteFor(
  userId: string,
  picked: ICase,
): Promise<{ caseDoc: ICase; engineCaseId: string } | null> {
  if (!engineConfigured() || (picked.module ?? 'case') !== 'case') return null;
  const settings = await getSettings();
  if (!settings.enginePilotUserIds?.some((id) => id.toString() === userId)) return null;
  if (picked.engine?.caseId) return { caseDoc: picked, engineCaseId: picked.engine.caseId };
  if (!settings.enginePilotCaseId) return null;
  const pilot = await Case.findById(settings.enginePilotCaseId);
  return pilot?.engine?.caseId ? { caseDoc: pilot, engineCaseId: pilot.engine.caseId } : null;
}

const ABANDONED = new Set(['candidate_disconnected', 'abandoned']);

/**
 * Write the engine's settlement onto the session (transcript as heard, status, times) and settle
 * credits. Idempotent: the engine may push it and Node may also fetch it; only the first applies.
 * Returns whether this call applied it.
 */
export async function applyEngineSettlement(sessionId: string, s: EngineSettlement): Promise<boolean> {
  if (!mongoose.isValidObjectId(sessionId)) return false;
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, 'engine.callId': s.callId, 'engine.settledAt': { $exists: false } },
    {
      $set: {
        transcript: (s.transcript ?? []).map((t) => ({ role: t.role, text: t.text, timestamp: new Date(t.timestamp) })),
        status: ABANDONED.has(s.endedReason) ? 'abandoned' : 'completed',
        endedAt: new Date(s.endedAt),
        durationSeconds: Math.max(0, Math.round(s.durationSeconds ?? 0)), // credits are charged on this
        'engine.endedReason': s.endedReason,
        'engine.summary': s.summary,
        'engine.settledAt': new Date(),
      },
    },
    { new: true },
  );
  if (!updated) return false;
  await settleSession(sessionId);
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the settlement from the engine and apply it. With `endIfLive`, a call still running after a
 * few seconds is ended first: the page asked to end, so a lost end_session must not keep it open.
 */
export async function pullEngineSettlement(session: ISession, opts: { endIfLive?: boolean; waitSeconds?: number } = {}): Promise<boolean> {
  const callId = session.engine?.callId;
  if (!callId || session.engine?.settledAt) return false;
  const wait = opts.waitSeconds ?? 0;
  for (let i = 0; ; i++) {
    const s = await fetchEngineSettlement(callId);
    if (s) return applyEngineSettlement(String(session._id), s);
    if (i >= wait) return false;
    if (opts.endIfLive && i === 4) await endEngineCall(callId, 'candidate_ended').catch(() => undefined);
    await sleep(1000);
  }
}

/** Bring a live-looking engine session up to date if its interview ended without Node hearing (best effort). */
export async function reconcileEngineSession(session: ISession): Promise<void> {
  if (session.status !== 'active' || !session.engine?.callId || session.engine.settledAt) return;
  try {
    await pullEngineSettlement(session);
  } catch (err) {
    console.warn(`engine reconcile ${String(session._id)}:`, (err as Error).message);
  }
}
