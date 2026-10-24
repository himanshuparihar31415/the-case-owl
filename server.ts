import 'dotenv/config';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './server/config/env.js';
import { connectDB } from './server/config/db.js';
import { errorHandler } from './server/middleware/errorHandler.js';
import { generalLimiter } from './server/middleware/rateLimiter.js';
import authRoutes from './server/modules/auth/auth.routes.js';
import caseRoutes from './server/modules/cases/case.routes.js';
import sessionRoutes from './server/modules/sessions/session.routes.js';
import reportRoutes from './server/modules/reports/report.routes.js';
import analyticsRoutes from './server/modules/analytics/analytics.routes.js';
import coachingRoutes from './server/modules/coaching/coaching.routes.js';
import billingRoutes from './server/modules/billing/billing.routes.js';
import adminRoutes from './server/modules/admin/admin.routes.js';
import resumeRoutes from './server/modules/resume/resume.routes.js';
import { internalRouter, voiceCallRouter } from './server/modules/engine/engine.routes.js';
import { webhook as razorpayWebhook } from './server/modules/billing/billing.controller.js';
import { seedPlans } from './server/modules/billing/plans.service.js';
import { setupVoiceWebSocket } from './server/modules/voice/voice.ws.js';

const app = express();
const httpServer = createServer(app);

// Required so express-rate-limit reads client IP correctly behind Railway/Vercel proxy
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));

// Razorpay webhook MUST read the raw body to verify the HMAC signature, so it
// is mounted BEFORE the JSON parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(generalLimiter);
app.use((req, _res, next) => {
  console.log(req.method, req.url);
  next();
});

// Health check — no DB required
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/coaching', coachingRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/resume-interviews', resumeRoutes);
// Interview engine (docs/engine-contract.md): the page's call brokering, and the engine's settle callback.
// HTTP only; the /api/voice WebSocket of today's pipelines is handled by the upgrade handler below.
app.use('/api/voice', voiceCallRouter);
app.use('/internal', internalRouter);

app.use(errorHandler);

// Serve built frontend — must come after API routes so /api/* is never caught here
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Use noServer mode so we control upgrade routing explicitly — avoids path-matching edge cases
const wss = new WebSocketServer({ noServer: true });
setupVoiceWebSocket(wss);

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname;
  console.log('WS upgrade request:', pathname);
  if (pathname === '/api/voice' || pathname === '/api/resume-interviews/voice') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

const PORT = Number(env.PORT);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`server listening on ${PORT}`);
  connectDB()
    .then(() => seedPlans().catch((e) => console.error('seedPlans failed:', e)))
    .catch((err) => {
      console.error('MongoDB connection failed (server stays up):', err.message);
    });
});
