import { Session, ISession } from '../../models/Session.js';
import { ANSWER_FIELDS, Case } from '../../models/Case.js';
import { User } from '../../models/User.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateHintWithAI } from '../../ai/client.js';
import { InterviewerStyle, TranscriptEntry } from '../../models/Session.js';
import { ensureWallet, reserve, settle, secondsToMinutes } from '../billing/wallet.service.js';
import { engineRouteFor, pullEngineSettlement, reconcileEngineSession } from '../engine/engine.service.js';

interface CreateSessionInput {
  userId: string;
  caseId: string;
  config: {
    difficulty: number;
    industry: string;
    caseType: string;
    interviewerStyle: InterviewerStyle;
    durationMinutes: number;
    voiceId?: string; // ElevenLabs voice for pipeline-voiced modules
  };
}

export async function createSession(input: CreateSessionInput): Promise<ISession> {
  const caseDoc = await Case.findById(input.caseId);
  if (!caseDoc) throw new AppError(404, 'Case not found');

  // Suspended users can't start interviews.
  const user = await User.findById(input.userId).select('suspended');
  if (user?.suspended) throw new AppError(403, 'Your account is suspended. Contact support.');

  // Pilot users' consulting cases run on the interview engine (and, for now, on its one pilot case).
  const engineRoute = await engineRouteFor(input.userId, caseDoc);

  // Reserve credits up front so a runaway session can never overspend and two
  // concurrent sessions can't share the same balance. Reject if there's nothing
  // to spend (and the plan isn't unlimited).
  const wallet = await ensureWallet(input.userId);
  const cap = wallet.perInterviewCapMinutes || 30;
  const reservedMinutes = await reserve(input.userId, cap);
  if (reservedMinutes <= 0) {
    throw new AppError(402, 'No interview credits left. Choose a plan to keep practising.');
  }

  return Session.create({
    userId: input.userId,
    caseId: engineRoute ? engineRoute.caseDoc._id : input.caseId,
    config: input.config,
    status: 'active',
    transcript: [],
    reservedMinutes,
    startedAt: new Date(),
    ...(engineRoute ? { engine: { caseId: engineRoute.engineCaseId } } : {}),
  });
}

// Idempotent: settles credits for a session exactly once (the atomic settled
// flag flip is the guard), whether it ends normally or is abandoned.
export async function settleSession(sessionId: string): Promise<void> {
  const session = await Session.findOneAndUpdate(
    { _id: sessionId, settled: { $ne: true } },
    { settled: true },
    { new: false }
  );
  if (!session) return; // already settled or not found
  const reserved = session.reservedMinutes ?? 0;
  const elapsedSeconds = session.durationSeconds ?? Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
  const elapsedMin = secondsToMinutes(elapsedSeconds);
  // Never charge more than was reserved (which is bounded by the per-interview cap).
  const actualMinutes = reserved > 0 ? Math.min(elapsedMin, reserved) : elapsedMin;
  await settle(session.userId.toString(), sessionId, actualMinutes, reserved);
}

export async function getUserSessions(
  userId: string,
  page = 1,
  limit = 10
): Promise<{ sessions: ISession[]; total: number }> {
  const skip = (page - 1) * limit;
  // Engine sessions whose interview ended without Node hearing of it (the tab closed) catch up here.
  const stale = await Session.find({ userId, status: 'active', 'engine.callId': { $exists: true } }).limit(5);
  await Promise.allSettled(stale.map(reconcileEngineSession));

  const [sessions, total] = await Promise.all([
    Session.find({ userId })
      .populate('caseId', 'title type industry difficulty')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit),
    Session.countDocuments({ userId }),
  ]);
  return { sessions, total };
}

export async function getSessionById(id: string, userId: string): Promise<ISession> {
  let session = await Session.findOne({ _id: id, userId });
  if (!session) throw new AppError(404, 'Session not found');
  if (session.engine?.callId && session.status === 'active') {
    await reconcileEngineSession(session);
    session = (await Session.findById(id)) ?? session;
  }
  await session.populate({ path: 'caseId', select: ANSWER_FIELDS });
  return session;
}

export async function endSession(id: string, userId: string, scratchpad?: string): Promise<ISession> {
  const session = await Session.findOne({ _id: id, userId });
  if (!session) throw new AppError(404, 'Session not found');
  if (session.engine) return endEngineSession(session, scratchpad);
  if (session.status !== 'active') throw new AppError(400, 'Session is already ended');

  const now = new Date();
  const durationSeconds = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);

  session.status = 'completed';
  session.endedAt = now;
  session.durationSeconds = durationSeconds;
  if (typeof scratchpad === 'string') session.scratchpad = scratchpad;
  await session.save();

  // Settle credits (consume actual, release the held estimate). Idempotent.
  await settleSession(id).catch((e) => console.error('settleSession failed:', e));

  return session;
}

/**
 * Ending an engine session: the engine owns the transcript and the times, so fetch its settlement
 * (the page has just sent end_session; it takes a second or two) rather than computing them here.
 * The scratchpad is saved even when the engine's settle callback got there first.
 */
async function endEngineSession(session: ISession, scratchpad?: string): Promise<ISession> {
  const id = String(session._id);
  if (session.status === 'active') {
    if (session.engine?.callId) {
      await pullEngineSettlement(session, { endIfLive: true, waitSeconds: 12 })
        .catch((e) => console.error(`engine settlement for ${id} failed:`, e));
    } else {
      // The page never got as far as opening the call: nothing was used.
      await Session.updateOne({ _id: id, status: 'active' }, { $set: { status: 'abandoned', endedAt: new Date(), durationSeconds: 0 } });
      await settleSession(id).catch((e) => console.error('settleSession failed:', e));
    }
  }
  if (typeof scratchpad === 'string') await Session.updateOne({ _id: id }, { $set: { scratchpad } });
  return (await Session.findById(id)) ?? session;
}

export async function appendTranscript(
  sessionId: string,
  entry: TranscriptEntry
): Promise<void> {
  await Session.updateOne(
    { _id: sessionId },
    { $push: { transcript: entry } }
  );
}

export async function getSessionHint(id: string, userId: string): Promise<string> {
  const session = await Session.findOne({ _id: id, userId }).populate('caseId');
  if (!session) throw new AppError(404, 'Session not found');
  // The engine keeps the live transcript, so a hint from Node's copy would be blind; engine hints
  // arrive with phase 3 (docs/engine-contract.md, the hint route).
  if (session.engine) throw new AppError(409, 'Hints are not available in this interview yet');

  const lastFiveExchanges = session.transcript.slice(-10);
  const hint = await generateHintWithAI(lastFiveExchanges);
  return hint;
}
