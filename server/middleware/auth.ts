import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

export interface AuthRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Authentication required'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token'));
  }
}

// Use AFTER requireAuth. Loads the user and checks the admin role from the DB
// (the JWT only carries userId, so role can't be forged client-side).
export async function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) return next(new AppError(401, 'Authentication required'));
    const { User } = await import('../models/User.js');
    const user = await User.findById(req.userId).select('role');
    if (!user || user.role !== 'admin') return next(new AppError(403, 'Admin access required'));
    next();
  } catch (err) {
    next(err);
  }
}
