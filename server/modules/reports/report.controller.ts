import { Response, NextFunction } from 'express';
import * as reportService from './report.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { Session } from '../../models/Session.js';

export async function getReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await reportService.getOrGenerateReport(req.params.sessionId, req.userId!);
    // Ship the FULL transcript (every turn) alongside the report so the user can
    // download the complete conversation — the report's analysis only carries the
    // key turns. Works for old reports too, since the transcript lives on the session.
    const session = await Session.findOne({ _id: req.params.sessionId, userId: req.userId! })
      .select('transcript startedAt');
    res.json({ report, transcript: session?.transcript ?? [] });
  } catch (err) {
    next(err);
  }
}

export async function regenerateReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await reportService.generateReport(req.params.sessionId, req.userId!);
    res.json({ report });
  } catch (err) {
    next(err);
  }
}
