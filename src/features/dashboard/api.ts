import { api } from '@/src/lib/api';
import { mockSource } from './mock';
import type { DashboardDataSource, DashboardOverview, OnboardingAnswers, Targets } from './types';

/* ─────────────────────────────────────────────────────────────────────────────
   The ONE place the dashboard talks to a backend.

   VITE_DASHBOARD_SOURCE=mock (default)  → fixtures + localStorage, no backend needed
   VITE_DASHBOARD_SOURCE=api             → the real endpoints below

   To go live: build the endpoints, set VITE_DASHBOARD_SOURCE=api. No component changes.
   Request/response shapes are the types in ./types.ts. `api` (src/lib/api.ts) adds the
   auth header and turns non-2xx responses into thrown Errors, which the UI surfaces.
   ───────────────────────────────────────────────────────────────────────────── */

const httpSource: DashboardDataSource = {
  /** GET /api/dashboard/overview → DashboardOverview */
  getOverview: () => api.get<DashboardOverview>('/dashboard/overview'),

  /** POST /api/dashboard/onboarding  body: OnboardingAnswers → { targets } */
  completeOnboarding: (answers: OnboardingAnswers) =>
    api.post<{ targets: Targets }>('/dashboard/onboarding', answers),

  /** PATCH /api/dashboard/targets  body: Targets → Targets */
  saveTargets: (targets: Targets) => api.patch<Targets>('/dashboard/targets', targets),

};

const useMock = (import.meta.env?.VITE_DASHBOARD_SOURCE as string | undefined) !== 'api';

export const dashboardSource: DashboardDataSource = useMock ? mockSource : httpSource;
export const isMockDashboard = useMock;
