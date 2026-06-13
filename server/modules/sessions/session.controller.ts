import { Response, NextFunction } from 'express';
import * as sessionService from './session.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function createSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { caseId, config } = req.body;
    if (!caseId || !config) throw new AppError(400, 'caseId and config are required');

    const session = await sessionService.createSession({
      userId: req.userId!,
      caseId,
      config,
    });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
}

export async function getUserSessions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await sessionService.getUserSessions(
      req.userId!,
      page ? Number(page) : 1,
      limit ? Number(limit) : 10
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSessionById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await sessionService.getSessionById(req.params.id, req.userId!);
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

export async function endSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { scratchpad } = (req.body ?? {}) as { scratchpad?: string };
    const session = await sessionService.endSession(req.params.id, req.userId!, scratchpad);
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

export async function getHint(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const hint = await sessionService.getSessionHint(req.params.id, req.userId!);
    res.json({ hint });
  } catch (err) {
    next(err);
  }
}
