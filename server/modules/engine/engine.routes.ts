// HTTP routes for sessions on the interview engine (docs/engine-contract.md, section 4):
//   POST /api/voice/call                       the page's WebRTC offer → the engine's answer + UI socket
//   POST /api/voice/call/:sessionId/reoffer    a new offer after the audio dropped
//   POST /internal/sessions/:id/settle         the engine's settle callback (service token only)
import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthRequest, requireAuth } from '../../middleware/auth.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';
import { Session } from '../../models/Session.js';
import { User } from '../../models/User.js';
import { EngineCallExists, EngineSettlement, createEngineCall, reofferEngineCall } from './engine.client.js';
import { applyEngineSettlement } from './engine.service.js';

const MAX_SDP = 20_000;

function sdpFrom(body: unknown): string {
  const sdp = (body as { sdpOffer?: unknown })?.sdpOffer;
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > MAX_SDP) {
    throw new AppError(400, 'A WebRTC audio offer (sdpOffer) is required');
  }
  return sdp;
}

async function ownEngineSession(sessionId: unknown, userId: string) {
  if (typeof sessionId !== 'string' || !mongoose.isValidObjectId(sessionId)) throw new AppError(400, 'sessionId is required');
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError(404, 'Session not found');
  if (!session.engine) throw new AppError(409, 'This session does not use the interview engine');
  if (session.status !== 'active') throw new AppError(409, 'This interview has ended');
  return session;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const voiceCallRouter = Router();

voiceCallRouter.post('/call', requireAuth, generalLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sdpOffer = sdpFrom(req.body);
    const session = await ownEngineSession(req.body?.sessionId, req.userId!);
    const sessionId = String(session._id);

    // The page reloaded (or React mounted twice in development): carry on the same interview on a
    // new audio connection rather than starting another.
    const resume = async (callId: string) => {
      const r = await reofferEngineCall(callId, sdpOffer);
      return res.json({ callId, sdpAnswer: r.sdpAnswer, ui: r.ui });
    };
    if (session.engine!.callId) return void (await resume(session.engine!.callId));

    const user = await User.findById(req.userId).select('name');
    try {
      const call = await createEngineCall({
        sessionId,
        userId: req.userId!,
        caseId: session.engine!.caseId,
        sdpOffer,
        maxMinutes: session.reservedMinutes || 30,
        candidateFirstName: user?.name?.trim().split(/\s+/)[0],
      });
      await Session.updateOne({ _id: sessionId, 'engine.callId': { $exists: false } }, { $set: { 'engine.callId': call.callId } });
      res.status(201).json(call);
    } catch (err) {
      if (!(err instanceof EngineCallExists)) throw err;
      // Another request for this session is opening the call right now: wait for its call id.
      for (let i = 0; i < 10; i++) {
        await sleep(300);
        const fresh = await Session.findById(sessionId).select('engine');
        if (fresh?.engine?.callId) return void (await resume(fresh.engine.callId));
      }
      throw new AppError(409, 'The interview is already starting in another tab');
    }
  } catch (err) {
    next(err);
  }
});

voiceCallRouter.post('/call/:sessionId/reoffer', requireAuth, generalLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sdpOffer = sdpFrom(req.body);
    const session = await ownEngineSession(req.params.sessionId, req.userId!);
    if (!session.engine!.callId) throw new AppError(409, 'The interview has not started yet');
    const r = await reofferEngineCall(session.engine!.callId, sdpOffer);
    res.json({ sdpAnswer: r.sdpAnswer, ui: r.ui });
  } catch (err) {
    next(err);
  }
});

function serviceTokenOk(req: Request): boolean {
  const expected = env.NODE_INTERNAL_TOKEN;
  const header = req.headers.authorization ?? '';
  if (!expected || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

export const internalRouter = Router();

internalRouter.post('/sessions/:id/settle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!serviceTokenOk(req)) throw new AppError(401, 'Unauthorized');
    const s = req.body as EngineSettlement;
    if (typeof s?.callId !== 'string' || !Array.isArray(s.transcript)) throw new AppError(400, 'Not a settle payload');
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError(404, 'Session not found');
    const exists = await Session.exists({ _id: req.params.id, 'engine.callId': s.callId });
    if (!exists) throw new AppError(404, 'Session not found');
    await applyEngineSettlement(req.params.id, s); // a repeat changes nothing and still answers 200
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
