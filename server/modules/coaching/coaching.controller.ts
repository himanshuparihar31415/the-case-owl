import { Response, NextFunction } from 'express';
import * as coachingService from './coaching.service.js';
import { AuthRequest } from '../../middleware/auth.js';

export async function getLessonIndex(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await coachingService.getLessonIndex(req.userId!, req.query.module as string | undefined));
  } catch (err) {
    next(err);
  }
}

export async function getLesson(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const lesson = await coachingService.getLesson(req.params.habitTag, req.query.module as string | undefined);
    if (!lesson) {
      res.status(404).json({ error: 'Unknown lesson' });
      return;
    }
    res.json({ lesson });
  } catch (err) {
    next(err);
  }
}

export async function recordView(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await coachingService.recordView(req.userId!, req.body?.habitTag as string | undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function getLoop(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ callback: await coachingService.getLoopCallback(req.userId!, req.params.sessionId) });
  } catch (err) {
    next(err);
  }
}
