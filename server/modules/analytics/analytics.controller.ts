import { Response, NextFunction } from 'express';
import * as analyticsService from './analytics.service.js';
import { AuthRequest } from '../../middleware/auth.js';

export async function getOverview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await analyticsService.getOverview(req.userId!);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getTrends(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const data = await analyticsService.getTrends(req.userId!, limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getWeaknesses(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await analyticsService.getWeaknesses(req.userId!);
    res.json({ weaknesses: data });
  } catch (err) {
    next(err);
  }
}

export async function getDashboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await analyticsService.getDashboard(req.userId!, req.query.module as string | undefined);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query as Record<string, string>;
    const data = await analyticsService.getHistory(
      req.userId!,
      page ? Number(page) : 1,
      limit ? Number(limit) : 10
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}
