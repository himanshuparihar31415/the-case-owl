# Dashboard feature

Two journeys behind `/dashboard`:

| User | Sees | Decided by |
|---|---|---|
| First login | `Onboarding` (5 questions, plan preview, choose baseline or prep) | `overview.profile.onboarded === false` |
| Everyone after | `CoachDashboard` (next action, pace, readiness by type, learning, history) | `overview.profile.onboarded === true` |

The page is `src/pages/Dashboard.tsx`. It only calls `useDashboard()`; it never knows whether data is mocked.

## Where things live

| File | Role |
|---|---|
| `types.ts` | **The backend contract.** `DashboardOverview` and the write payloads. |
| `api.ts` | The only place that talks to a backend. Mock or HTTP, chosen by one env var. |
| `mock.ts` | Fixtures + localStorage. Front-end development only. |
| `logic.ts` | Pure rules: pace %, status badges, which nudge to show, suggested targets. |
| `config.ts` | Static product settings (option lists, interview routes, baseline settings). |
| `components/` | Presentational pieces. They receive plain data and callbacks. |

## Going live

1. Build the three endpoints below, returning the shapes in `types.ts`.
2. Set `VITE_DASHBOARD_SOURCE=api` (default is `mock`).
3. No component changes needed. The dev scenario bar disappears automatically when the source is not `mock`.

```
GET   /api/dashboard/overview          → DashboardOverview
POST  /api/dashboard/onboarding        body OnboardingAnswers   → { targets: Targets }
PATCH /api/dashboard/targets           body Targets             → Targets
```

All four need the normal auth header (`src/lib/api.ts` adds it). Non-2xx responses surface in the UI as an error message.

## What the server owns vs what the client derives

**Server returns raw facts:** counts (lessons/interviews this week and this month), targets, per-type scores, the pending-lesson queue, weaknesses, recent interviews.

**Client derives (logic.ts):** the "expected by today" marker on the trackers, which coach message to show ("plan is set" for a new user, otherwise a neutral next step), "up next" lessons, per-type status (untested / prep gap / building / ready).

If you later want any of that decided server-side, return the field and have `logic.ts` prefer it. Optional server overrides already supported: `readiness.label`, `readiness.deltaNote`, `coach.focusType`, `coach.nextStepNote`, `coach.gaps[type]`.

## Backend rules the UI relies on

- **Week = Monday to Sunday**, in the user's local time. `activity.weekPrep` / `weekInterviews` count since Monday; `monthInterviews` counts the calendar month.
- **`profile.onboarded`** flips to true on `POST /onboarding` (body includes `roles`, an array: the user can pick several target roles). The server decides the targets from the answers (the client shows `suggestTargets()` in `logic.ts` as a preview, so keep the two rules in sync: shorter runway, higher targets).
- **A brand-new user (no lessons, no interviews) is never shown as "behind".** The UI shows "Just started" and a "plan is set" nudge. Don't fake activity to avoid a bad badge.
- **`recent.items`** should already exclude unfinished sessions under a minute; report how many in `hiddenShort`.
- **`reportHref` and `LessonRef.href`** are app routes the server chooses (resume reports live under `/report/resume/:id`).

## Mock scenarios (development)

A strip at the top of the dashboard (dev only, mock source only) switches between the two states, or use `?scenario=`:

`new` (onboarding) · `started` (just onboarded, empty dashboard)

Onboarding answers and edited targets persist in `localStorage` (`dashboard_mock_v1`, `dashboard_onboarding_draft_v1`). Choosing **New user** in the strip resets them.

## Not wired yet (needs backend or another page)

- "Start baseline" opens the case setup. A dedicated 15-minute baseline flow does not exist yet (`BASELINE_ROUTE` in `config.ts`).
- Recent interviews show `{total} total` but there is no full-history page to link to.
