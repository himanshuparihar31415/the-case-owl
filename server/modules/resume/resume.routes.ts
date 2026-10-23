import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimiter.js';
import { AppError } from '../../middleware/errorHandler.js';
import { resumeUpload, RESUME_MAX_BYTES } from '../../middleware/resumeUpload.js';
import { deleteSavedResume, listSavedResumes, parseSetup, startResumeInterview } from './resume.service.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';
import * as sessionController from '../sessions/session.controller.js';
import * as reportController from '../reports/report.controller.js';

const router = Router();

// POST /api/resume-interviews  (multipart: resume, role, topics, durationMinutes, style)
// Reads the resume, builds the interviewer brief, creates the case + session.
router.post(
  '/',
  requireAuth,
  aiLimiter,
  (req, res, next) => {
    resumeUpload.single('resume')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, `That file is over the ${RESUME_MAX_BYTES / 1024 / 1024} MB limit.`));
      }
      next(new AppError(400, err instanceof Error ? err.message : 'Upload failed'));
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const resumeId = typeof req.body?.resumeId === 'string' && req.body.resumeId ? req.body.resumeId : undefined;
      if (!req.file && !resumeId) throw new AppError(400, 'Upload your resume (PDF or DOCX) or choose a saved one');
      const setup = parseSetup(req.body as Record<string, unknown>);
      const result = await startResumeInterview({ userId: req.userId!, file: req.file, resumeId, ...setup });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// The user's saved resumes (declared before /:id so 'resumes' is not read as a session id).
router.get('/resumes', requireAuth, generalLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json({ resumes: await listSavedResumes(req.userId!) }); } catch (err) { next(err); }
});
router.delete('/resumes/:resumeId', requireAuth, generalLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await deleteSavedResume(req.userId!, String(req.params.resumeId)); res.json({ ok: true }); } catch (err) { next(err); }
});

// Everything below reuses the shared session/report controllers, exposed under this
// prefix so the whole resume flow can be routed to one backend (see vite.config.ts).
// The controllers read :id / :sessionId, so alias the param.
const asSession = (h: typeof sessionController.getSessionById) =>
  (req: AuthRequest, res: Response, next: NextFunction) => h(req, res, next);
const asReport = (h: typeof reportController.getReport) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    req.params.sessionId = req.params.id;
    return h(req, res, next);
  };

router.get('/:id', requireAuth, generalLimiter, asSession(sessionController.getSessionById));
router.patch('/:id/end', requireAuth, generalLimiter, asSession(sessionController.endSession));
router.get('/:id/report', requireAuth, generalLimiter, asReport(reportController.getReport));

export default router;
