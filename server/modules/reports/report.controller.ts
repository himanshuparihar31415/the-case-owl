import { Response, NextFunction } from 'express';
import * as reportService from './report.service.js';
import { AuthRequest } from '../../middleware/auth.js';

export async function getReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await reportService.getOrGenerateReport(req.params.sessionId, req.userId!);
    res.json({ report });
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
