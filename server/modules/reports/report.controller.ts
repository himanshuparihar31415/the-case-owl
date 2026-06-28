import { Response, NextFunction } from 'express';
import * as reportService from './report.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { Session } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { User } from '../../models/User.js';

export async function getReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await reportService.getOrGenerateReport(req.params.sessionId, req.userId!);
    // Surface the pre-generated answer key (model solution, tree, ideal script)
    // so the report can show it at the end. Lives on the case; absent for
    // legacy/seeded/custom cases.
    let solution: {
      plausibleSolution?: string; solutionTree?: unknown; idealScript?: unknown;
      exhibits?: unknown; quant?: unknown; commonWrongTurns?: unknown;
    } | null = null;
    // The case brief (prompt + scenario + key data) so the report can show the
    // candidate WHAT they were asked, formatted, at the top of the Overview.
    let caseBrief: {
      title?: string; type?: string; industry?: string;
      prompt?: string; scenario?: string;
      keyDataPoints?: unknown;
    } | null = null;
    // Also ship the FULL transcript (every turn) so the user can download the
    // complete conversation — the report's analysis only carries key turns.
    const session = await Session.findOne({ _id: req.params.sessionId, userId: req.userId! }).select('caseId transcript supervisorFlags');
    if (session?.caseId) {
      const caseDoc = await Case.findById(session.caseId).select('title type industry prompt scenario keyDataPoints plausibleSolution solutionTree idealScript exhibits quant commonWrongTurns');
      const hasExhibits = Array.isArray(caseDoc?.exhibits) && caseDoc!.exhibits!.length > 0;
      if (caseDoc && (caseDoc.scenario || caseDoc.prompt)) {
        caseBrief = {
          title: caseDoc.title,
          type: caseDoc.type,
          industry: caseDoc.industry,
          prompt: caseDoc.prompt,
          scenario: caseDoc.scenario,
          keyDataPoints: caseDoc.keyDataPoints,
        };
      }
      if (caseDoc && (caseDoc.plausibleSolution || caseDoc.solutionTree || caseDoc.idealScript || hasExhibits)) {
        solution = {
          plausibleSolution: caseDoc.plausibleSolution,
          solutionTree: caseDoc.solutionTree,
          idealScript: caseDoc.idealScript,
          // Pharma exhibit cases: show the exhibit set, quant derivation, and traps
          // as post-interview learning. quant.derivation/answer are intentionally
          // included here — the session is over, this is the teaching layer.
          exhibits: hasExhibits ? caseDoc.exhibits : undefined,
          quant: caseDoc.quant,
          commonWrongTurns: caseDoc.commonWrongTurns,
        };
      }
    }
    // Supervisor compliance flags are admin-only debug data — omit for everyone else.
    let supervisor: unknown[] | undefined;
    const me = await User.findById(req.userId!).select('role');
    if (me?.role === 'admin') supervisor = session?.supervisorFlags ?? [];

    res.json({ report, solution, caseBrief, transcript: session?.transcript ?? [], supervisor });
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
