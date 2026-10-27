import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { env } from '../server/config/env.js';
import { connectDB } from '../server/config/db.js';
import { errorHandler } from '../server/middleware/errorHandler.js';
import { generalLimiter } from '../server/middleware/rateLimiter.js';
// Shared plumbing (same DB, same users/JWT) imported from the existing server.
import authRoutes from '../server/modules/auth/auth.routes.js';
// New AI-logic modules.
import caseRoutes from './modules/cases/case.routes.js';
import sessionRoutes from './modules/sessions/session.routes.js';
import reportRoutes from './modules/reports/report.routes.js';
import coachingRoutes from './modules/coaching/coaching.routes.js';

process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

const app = express();
const httpServer = createServer(app);
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(generalLimiter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', server: 'server2-dd', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/coaching', coachingRoutes);

app.use(errorHandler);

const PORT = Number(process.env.SERVER2_PORT ?? 5051);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`server2-dd listening on ${PORT}`);
  connectDB().catch((err) => console.error('MongoDB connection failed (server stays up):', err.message));
});
void env;
