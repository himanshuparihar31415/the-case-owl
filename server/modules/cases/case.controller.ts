import { Response, NextFunction } from 'express';
import * as caseService from './case.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { CaseType, Industry } from '../../models/Case.js';

export async function listCases(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, industry, difficulty, tab, page, limit } = req.query as Record<string, string>;
    const result = await caseService.listCases(
      {
        type: type as CaseType,
        industry: industry as Industry,
        difficulty: difficulty ? Number(difficulty) : undefined,
        tab,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 12,
      },
      req.userId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listMyCases(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const result = await caseService.listMyCases(
      req.userId!,
      limit ? Number(limit) : 12,
      page ? Number(page) : 1
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createCustomCase(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    let scenario: string;

    if (req.file) {
      const pdfParse = (await import('pdf-parse')).default;
      const parsed = await pdfParse(req.file.buffer);
      scenario = parsed.text.trim();
    } else {
      scenario = req.body.scenario;
    }

    if (!req.body.title || !scenario) {
      throw new AppError(400, 'title and scenario (or a PDF file) are required');
    }

    const c = await caseService.createCustomCase(req.userId!, {
      title: req.body.title,
      scenario,
      description: req.body.description,
      type: req.body.type as CaseType | undefined,
      industry: req.body.industry as Industry | undefined,
      difficulty: req.body.difficulty ? Number(req.body.difficulty) : undefined,
    });

    res.status(201).json({ case: c });
  } catch (err) {
    next(err);
  }
}

export async function getCaseById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const c = await caseService.getCaseById(req.params.id);
    res.json({ case: c });
  } catch (err) {
    next(err);
  }
}

export async function generateCase(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { module, type, industry, difficulty, productFormat } = req.body;
    const diff = Number(difficulty);
    if (!diff) throw new AppError(400, 'difficulty is required');

    let c;
    if (module === 'product') {
      const fmt = (productFormat ?? 'design') as 'design' | 'strategy' | 'rootcause' | 'prioritization';
      c = await caseService.generateProductCase(fmt, diff);
    } else if (module === 'guesstimate') {
      c = await caseService.generateGuesstimate(diff);
    } else {
      if (!type || !industry) throw new AppError(400, 'type and industry are required for a consulting case');
      c = await caseService.generateCase(type as CaseType, industry as Industry, diff);
    }
    res.status(201).json({ case: c });
  } catch (err) {
    next(err);
  }
}

export async function seedCases(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const count = await caseService.seedCases();
    res.json({ message: `Seeded ${count} cases` });
  } catch (err) {
    next(err);
  }
}
