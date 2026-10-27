import type { TypeKey } from './types';

/* Static product configuration for the dashboard. Nothing here is user data.
   If any of it needs to be editable without a deploy, move it behind an endpoint
   and return it on DashboardOverview. */

/** Used to convert an interviews-per-week target to per-month and back. */
export const WEEKS_PER_MONTH = 4.3;

export const BASELINE_MINUTES = 15;

export const ONBOARDING_OPTIONS = {
  roles: ['Consulting', 'Product', 'Finance / IB', 'Sales & Marketing', 'Operations', 'General management'],
  companies: ['McKinsey', 'BCG', 'Bain', 'Kearney', 'Accenture Strategy', 'Deloitte', 'Amazon', 'Google', 'Microsoft', 'Goldman Sachs', 'HUL', 'P&G'],
  timelines: ['Under 2 weeks', '2–4 weeks', '1–2 months', '2+ months'],
} as const;

/** Shorter runway → higher weekly targets. [lessons per week, interviews per week]. */
export const TIMELINE_TARGETS: Record<string, [number, number]> = {
  'Under 2 weeks': [6, 5],
  '2–4 weeks': [5, 4],
  '1–2 months': [4, 3],
  '2+ months': [3, 2],
};

/** Where each interview type starts today. Case/guesstimate/product reuse the /config flow. */
export const INTERVIEW_ROUTES: Record<TypeKey, { to: string; state?: Record<string, unknown> }> = {
  case: { to: '/config', state: { module: 'case' } },
  guess: { to: '/config', state: { module: 'guesstimate' } },
  product: { to: '/config', state: { module: 'product' } },
  gd: { to: '/interview/gd' },
  resume: { to: '/interview/resume' },
  company: { to: '/companies' },
};

/** The baseline is a short case for now; swap when a dedicated baseline flow exists. */
export const BASELINE_ROUTE = { to: '/config', state: { module: 'case', baseline: true } };

/** Short names for tight spaces . */
export const SHORT_TYPE_LABEL: Partial<Record<TypeKey, string>> = {
  gd: 'GD',
  company: 'Company',
};
