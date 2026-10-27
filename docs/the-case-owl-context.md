# The Case Owl — Platform Context

> Context file for an AI assistant. Describes what The Case Owl is, who it's for, how it works, and how it's built. Snapshot as of Oct 2026 (branch `dhrumil_the_case_owl`). No secrets included.

## 1. What it is (one line)

**The Case Owl is a voice-based AI case-interview practice platform.** A candidate talks out loud with an AI "partner" who runs a realistic consulting / product / guesstimate interview, then gets a detailed, timestamped report showing exactly where they lost the room — and the one thing to fix first.

- **Tagline / voice:** "Sit across from a partner. As many times as it takes." · "Nothing you say gets past the owl." · "The chair is empty."
- **Audience:** MBA and pre-MBA candidates preparing for MBB-style consulting interviews, PM interviews, and market-sizing rounds. Primary market: **India** (pricing in INR + GST, Razorpay).
- **Core problem it solves:** Real case practice is scarce, expensive, and feedback from friends is too polite ("that was great"). A handful of interviews (~1% acceptance at top firms, 3–4 rounds, 0 do-overs) decide years of a career. The Case Owl gives unlimited realistic reps with blunt, specific feedback.
- **Brand mascot:** a navy owl with cyan eyes that "watches" — catches missed structure, unvalidated numbers, filler words, long pauses.

## 2. Product — the user journey

1. **Landing page** → sign up (email + password). New accounts get **free promo credits** (default 90 credit-minutes ≈ 3 interviews × 30-min cap).
2. **Library / Config** — pick an interview **module** and set it up:
   - **Consulting (`case`)** — case types: profitability, market entry, M&A, growth, pricing, operations; industries: tech, CPG, pharma, finance, energy, automotive, retail. Cases can include **exhibits** (charts/tables revealed mid-interview) and quant tasks.
   - **Product (`product`)** — PM interviews in 4 formats: design, strategy, root-cause, prioritization.
   - **Guesstimate (`guesstimate`)** — market sizing / estimation.
   - Config: difficulty (1–4), interviewer style (**supportive / neutral / stress**), duration, voice.
   - Cases come from a seeded library, are **AI-generated on demand**, or are **custom** (user pastes/uploads a case — e.g. PDF — and the AI extracts a structured case).
3. **Live session** (voice, in-browser, mic only) — the AI partner speaks, listens, interrupts when logic drifts, drills weak assumptions, reveals exhibits at the right moment. UI shows: case brief + key data, a stage stepper (Case Understanding → Structuring → Analysis → Recommendation), live transcript (searchable, bookmarkable), scratchpad, hints, focus modes (balanced/case/analysis/transcript).
4. **Report** after the session:
   - Overall score + grade (STRONG_PASS / PASS / BORDERLINE / FAIL) and percentile.
   - **Three-pillar composite score:** Navigation 40% (how well you traversed the "case map"), Structure 30%, Communication 30%.
   - Competency scores (structure, math, business judgment, communication, creativity, hypothesis — set varies by module).
   - **Case map / tree:** the AI builds a reference solution tree for the case and scores which nodes the candidate found (must-find critical nodes flagged).
   - Timestamped "Caught" moments (e.g. `02:08 — load-bearing assumption never validated`), filler/pace stats (e.g. "like" × 9, 116 wpm), strengths, improvements, missed opportunities — all written in the second person.
   - **Ideal Transcript** — a model interview walking the best path through the same case.
   - "Next rep · P0" — the one thing to fix first.
5. **Dashboard** — Focus/Stats views, 5-session trends, weaknesses, session & report history, AI progress insights.
6. **Learn / Lessons (coaching loop)** — micro-lessons tied to detected **habit tags** (category-specific habit taxonomies per module), frameworks per category, curated resources, and a linked weekly plan.
7. **Billing** — plans and credit wallet.

## 3. Pricing & credits

- **1 credit = 1 interview minute.** Per-interview cap: 30 minutes.
- Plans (INR, GST 18% extra):
  - **Starter** ₹1,499/mo — 150 credits (~5 scored interviews), core case types, full report + transcript.
  - **Pro** ₹3,999/mo — unlimited interviews, all firm styles + exhibits, dashboard + trends, weak-spot targeting. ("Most reps")
  - **Sprint** ₹6,499 / 2 weeks — everything in Pro + daily targeted plan + full mock-day loop.
- Wallet tracks subscription credits (reset each cycle), top-up credits (don't reset), and reserved credits (held during a live session, settled to actual minutes after). Every movement is a ledger entry (idempotent).
- Payments via **Razorpay** (orders, signature verify, webhook).

## 4. Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript, Vite 6, Tailwind CSS v4, React Router 7, `motion`, Recharts, `@xyflow/react` + dagre (case-map trees), lucide icons |
| Backend | Node + Express (TypeScript, run with `tsx`), `ws` WebSocket server, Mongoose/MongoDB, Zod env validation, express-rate-limit, multer + pdf-parse (case uploads) |
| Auth | Email + password, bcrypt hashing, JWT (Bearer header; WS passes token as query param). Roles: `user` / `admin` (admin checked from DB). |
| AI | OpenAI **gpt-4o** (interviewer turns, case generation, evaluation, hints, ideal transcripts, trees, insights), **gpt-4o-transcribe** via OpenAI Realtime transcription-only session (STT with server VAD), **text-embedding-3-small** (semantic matching), **ElevenLabs** TTS (`eleven_turbo_v2_5`; OpenAI TTS used in the PM pipeline plan) |
| Payments | Razorpay |
| Hosting | Backend on **Railway** (`casecoachaiv1-production.up.railway.app`, healthcheck `/api/health`). Frontend on **Vercel** (rewrites `/api/*` to Railway). |

### Voice architecture
All modules run a custom **STT → LLM → TTS pipeline** over one WebSocket (`/api/voice`):
browser mic (PCM16 @ 24 kHz, base64) → server → OpenAI streaming transcription (VAD detects when the candidate stops) → gpt-4o turn (structured output / function-calling; tracks stage, assesses each turn) → ElevenLabs streamed TTS → browser. Supports barge-in. Separate pipeline files per module: `consulting.pipeline.ts`, `pm.pipeline.ts`, `guesstimate.pipeline.ts`. A **supervisor** does deterministic checks so the interviewer doesn't leak forbidden info (e.g., the solution) too early. (The earlier all-in-one OpenAI Realtime voice model was retired.)

## 5. Codebase map

```
server.ts                      Express app, route mounting, WS upgrade for /api/voice, serves built frontend
server/config/                 env (zod), db
server/middleware/             auth (requireAuth, requireAdmin), rateLimiter, upload, errorHandler
server/models/                 User, Case, Session, Report, Wallet, LedgerEntry, Plan, PaymentIntent,
                               ProgressInsight, LessonView, Setting, AuditLog
server/ai/                     client.ts (OpenAI calls), prompts.ts (all prompts), habits.ts (habit taxonomy)
server/modules/
  auth/        /api/auth       signup, login, logout, me
  cases/       /api/cases      list, mine, custom (upload), generate, get, seed
  sessions/    /api/sessions   create, list, get, end, hint
  reports/     /api/reports    get/generate report, regenerate, ideal transcript; pillarScore.ts, treeScore.ts
  analytics/   /api/analytics  overview, trends, weaknesses, dashboard, history
  coaching/    /api/coaching   lesson index, lesson, record view, loop callback
  billing/     /api/billing    plans, wallet, checkout, verify, webhook
  admin/       /api/admin      user detail, adjust credits, suspend, plans CRUD, audit log, settings
  voice/                       voice.ws.ts, supervisor.ts, pm/* pipelines, openai-stt.ts, elevenlabs-tts.ts
src/
  App.tsx                      routes + auth gate (token in localStorage `auth_token`, validated via /auth/me)
  pages/                       Landing, Dashboard, Library, Config, Session, Report, Learn, Lesson, Billing
  components/                  AuthModal, CaseTree, ExhibitCard, AddCaseModal, layout/Navbar, Footer
  lib/api.ts                   fetch wrapper (/api base, Bearer token), WS URL builder (VITE_API_URL)
docs/pm-pipeline-plan.md       design doc for the PM STT→LLM→TTS interviewer
```

## 6. Running locally

- `npm install`
- **Frontend only against hosted backend:** `.env.local` sets `API_PROXY_TARGET=https://casecoachaiv1-production.up.railway.app`; run `npm run dev` (Vite on :5173, proxies `/api` incl. WebSocket). Note: this hits **production** data and real payments.
- **Full stack:** backend `npm run server:dev` (port 5050) with `.env` (MONGODB_URI, JWT_SECRET, OPENAI_API_KEY, ELEVENLABS_*, RAZORPAY_*), frontend `npm run dev`.
- `npm run build` (Vite → `dist/`), `npm start` (production server), `npm run lint` (tsc).

## 7. Known gaps / not implemented

- "Forgot password" button has no handler and no backend endpoint.
- No OAuth/social login, no email verification, no 2FA.
- Logout is client-side only (JWT not revoked server-side).
- Admin APIs exist but there's **no admin UI** in the frontend.
- `/settings` page is a "coming soon" placeholder.
- `package.json` name is still the template `react-example`; README is the AI Studio template.

## 8. Design identity

- Landing: navy `#13294A` / `#1C3354`, cyan `#1BA6E1` / `#1488C0`, light bg `#F4F6FA`, amber `#CF7C20` ("caught"), green `#1C9A6A` ("better"). Fonts: Poppins (display), Inter (body), JetBrains Mono (timestamps).
- App: Material-style tokens (primary `#002046`, accent `#08aae4`), Manrope headlines + Inter body.
- Tone: confident, blunt, slightly dry. Avoid generic SaaS language.
