import { Response, NextFunction } from 'express';
import * as reportService from './report.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { Session } from '../../models/Session.js';
import { Case } from '../../models/Case.js';

export async function getReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await reportService.getOrGenerateReport(req.params.sessionId, req.userId!);
    // Surface the pre-generated answer key (model solution, tree, ideal script)
    // so the report can show it at the end. Lives on the case; absent for
    // legacy/seeded/custom cases.
    let solution: { plausibleSolution?: string; solutionTree?: unknown; idealScript?: unknown } | null = null;
    // Also ship the FULL transcript (every turn) so the user can download the
    // complete conversation — the report's analysis only carries key turns.
    const session = await Session.findOne({ _id: req.params.sessionId, userId: req.userId! }).select('caseId transcript');
    if (session?.caseId) {
      const caseDoc = await Case.findById(session.caseId).select('plausibleSolution solutionTree idealScript');
      if (caseDoc && (caseDoc.plausibleSolution || caseDoc.solutionTree || caseDoc.idealScript)) {
        solution = {
          plausibleSolution: caseDoc.plausibleSolution,
          solutionTree: caseDoc.solutionTree,
          idealScript: caseDoc.idealScript,
        };
      }
    }
    res.json({ report, solution, transcript: session?.transcript ?? [] });
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
