# The Case Owl Engineering Playbook

How the team builds The Case Owl with Claude Code: the working loop every change follows, the commands
that run it, the guardrails that protect production, and worked examples that show it end to end.

| | |
|---|---|
| **For** | Everyone who changes this repo, and every Claude Code session that works in it |
| **Canonical copy** | This file. The [web version](https://claude.ai/artifact/PYBY2RGEtZKfdYyPW8tvQG) is a rendering of it; when they differ, this file wins |
| **Machinery reference** | [.claude/README.md](../.claude/README.md): every rule, command, agent, workflow and hook in detail |
| **Last updated** | 31 Oct 2026 |

## Contents

1. [How the system fits together](#1-how-the-system-fits-together)
2. [First-time setup](#2-first-time-setup)
3. [The working loop](#3-the-working-loop)
4. [Pick the right path](#4-pick-the-right-path)
5. [Worked examples](#5-worked-examples)
6. [Recipes](#6-recipes)
7. [Commands, agents and workflows at a glance](#7-commands-agents-and-workflows-at-a-glance)
8. [Hard rules](#8-hard-rules)
9. [Branches and commits](#9-branches-and-commits)
10. [Habits that keep the system honest](#10-habits-that-keep-the-system-honest)
11. [Troubleshooting](#11-troubleshooting)
12. [Changing this playbook](#12-changing-this-playbook)

---

## 1. How the system fits together

The setup has four layers. Each does a job the others cannot.

| Layer | Job | Where it lives |
|---|---|---|
| **Knowledge** | What Claude must know: the map of the repo, where the truth lives, the loop, the hard rules | [CLAUDE.md](../CLAUDE.md) (every session), [.claude/rules/](../.claude/rules/) (loaded by path), [STATUS.md](STATUS.md) |
| **Procedures** | How recurring jobs are done, the same way every time | Slash commands in [.claude/skills/](../.claude/skills/), multi-agent [workflows](../.claude/workflows/) |
| **Specialists** | Independent second opinions, each in its own context | Subagents in [.claude/agents/](../.claude/agents/): reviewers, verifier, interview analyst |
| **Guardrails** | What must happen every time, enforced by the harness rather than by memory | Hooks in [.claude/hooks/](../.claude/hooks/), permissions in [settings.json](../.claude/settings.json) |

### Where the truth lives

| Question | Source of truth |
|---|---|
| What is live, in progress, open | [docs/STATUS.md](STATUS.md) |
| What the product is for | [docs/the-case-owl-context.md](the-case-owl-context.md) |
| Interview engine design and its dated decisions | [docs/interview-engine-architecture.md](interview-engine-architecture.md) |
| What the engine and the platform send each other | `engine/app/contract.py`, described in [docs/engine-contract.md](engine-contract.md) |
| A feature's design and what was actually built | [docs/specs/](specs/) |
| How to run, test and deploy the engine | [engine/README.md](../engine/README.md) |

**Never let a doc lie.** The code is the truth for what the software does. When a doc disagrees with
the code, the doc is fixed in the same change. Sessions share no memory, so the repo is the handoff.

---

## 2. First-time setup

You need Node 20 or later, npm, and [uv](https://docs.astral.sh/uv/) (for the engine's Python).

```bash
npm install
```
```bash
cd engine && uv sync
```
```bash
claude --version
```

Then:

1. Open the repo in Claude Code (CLI, desktop app or IDE extension).
2. Accept the **workspace-trust** prompt. Until you do, the shared hooks and allow rules stay off.
3. Type `/` to see the project's commands.
4. Read the **session brief**, the first thing every session shows: your branch, how far it is from
   `main`, uncommitted changes, and the "Now" list from STATUS.md.

Personal preferences go in `.claude/settings.local.json` and `CLAUDE.local.md`. Both are gitignored.

---

## 3. The working loop

Every change follows the same loop. A trivial change (a typo, a copy tweak, a one-line fix with an
obvious check) can skip from Build to Ship.

| # | Step | What happens | Command |
|---|---|---|---|
| 1 | **Orient** | Read the session brief, the area's doc and the code around the change. Sync with `develop` if behind | Session brief; rules load on their own |
| 2 | **Plan** | A spec: problem, design, files, risks, how it will be proven. You approve it, and its design is frozen | `/spec` |
| 3 | **Build** | Small steps that match the surrounding code. Hooks guard secrets, generated files and production | |
| 4 | **Verify** | Type check, build, engine tests; evals for interviewer behaviour; a look in the browser for UI | `/check`, `/engine-evals` |
| 5 | **Review** | Independent reviewers read the diff without being told what the author thinks of it | `/review-diff`, `/review-changes` |
| 6 | **Reconcile** | The spec's "As built" section records every difference from the plan: deliberate (with the reason) or a bug to fix | `/close-spec` |
| 7 | **Ship** | Branch up to date with `develop`, conventional commit, push, a pull request into `develop` (CI runs on it); a release is a pull request from `develop` to `main` | `/ship` |
| 8 | **Hand off** | STATUS.md and the verified lists say what is true; a short note for the next person | `/handoff` |

### Definition of done

- The gates for the changed area pass: no new type errors, no failing tests.
- Behaviour changes are proven by measured pass rates over repeated runs, and the report names what
  still needs a human test (voice, timing, echo, real devices).
- The docs, the spec and STATUS.md describe what the code now does.
- The final message says exactly what was run, what passed, and what was not verified.

---

## 4. Pick the right path

| The change | Path |
|---|---|
| Typo, copy, styling tweak | Ask for it → the Stop check runs → `/ship` |
| A bug with an obvious cause | Ask for the fix → `/check` → `/review-diff` if it touches routes, money or the engine → `/ship` |
| A feature, or anything touching a data model, money, auth, prompts, the contract or production | `/spec` → build → `/check` → `/review-diff` → `/close-spec` → `/ship` → `/handoff` |
| Something the interviewer said or did | `/debug-interview` (evidence, root cause, structural fix, evals) |
| What the engine and platform send each other | `/contract-change` |
| A release of the interview engine | `/engine-deploy` |
| A large or risky change before it ships | `/review-changes` (several reviewers plus skeptics) |

---

## 5. Worked examples

The scenarios below are illustrative: the bugs and outputs are made up to show the flow, but every
command, file, check and guardrail message is real. Text after `>` is what you type; indented blocks
are what you see.

### Example A: Starting a session

Every session opens with a brief from the `session-brief` hook. You do nothing to get it.

```text
Session brief (.claude/hooks/session-brief.mjs):
- Branch: engine/reoffer-timeout
- Up to date with origin/develop, 2 commits ahead (fetched today).

Now, from docs/STATUS.md (updated 31 Oct 2026):
- Engine pilot is live. Consulting interviews of users on the pilot list run on the interview engine…
- Railway redeploys on engine-only commits…
- Billing has open bugs, from a code-reading audit on 31 Oct…
```

If it says you are behind `develop`, bring the branch up to date before building. If it says you are on
`main` or `develop`, branch off first: `main` is production, and both change only by pull request.

### Example B: A small bug fix

**Scenario.** The report page shows "NaN wpm" when a session ended before the candidate spoke.

```text
> The report page shows "NaN wpm" for sessions where the candidate never spoke. Fix it.
```

1. Claude reads `src/pages/Report.tsx` and the report service, finds the division by zero words, and
   fixes it where the pace is computed, matching the surrounding code.
2. When Claude finishes the turn, the **Stop hook** runs the type check because `.ts`/`.tsx` files
   changed. Had the fix introduced a type error, Claude would have been sent back:

   ```text
   New TypeScript errors (beyond the known ones in .claude/hooks/tsc-baseline.json):
   src/pages/Report.tsx(212,14): error TS2322: Type 'string' is not assignable to type 'number'.

   Fix these before finishing. If they were there before your change, or this turn deliberately
   leaves work in progress, say so plainly in your reply instead.
   ```

3. Claude reports what it changed, what it ran, and what it did not check (for example, "not looked
   at in the browser").
4. When you are happy: `> /ship`. It checks the branch is current with `main`, shows you the files
   and a message such as `fix(report): show pace only when the candidate spoke`, and commits on your yes.

No spec: the cause is obvious and the change is local.

### Example C: A feature with a spec

**Scenario.** STATUS.md lists an open billing bug: when a candidate closes the tab, the session's
credit hold is never released. You want a sweeper that settles abandoned sessions.

**1. Plan.**

```text
> /spec Release credit holds left by abandoned sessions
```

Claude reads the wallet service, the session model and the billing audit in STATUS.md, then writes
`docs/specs/0001-abandoned-session-sweeper.md` from the template. An excerpt:

```markdown
## Problem
A session reserves 30 credits when it starts and settles them when it ends. If the page is closed
or a deploy drops the socket, nothing ends the session, so the hold stays reserved for good.

## Proposed design
- A sweeper runs every 5 minutes in the Node service.
- It settles sessions still `active` whose last activity is older than 35 minutes (the 30-minute
  cap plus a grace period), charging the minutes actually used.
- Settling is a conditional update on `status: 'active'`, so a sweep and a late "end" from the page
  can never both apply.
Rejected: settling on socket close. A refresh would end a live interview.

## Risks
| Risk                         | Applies? | How it is handled                                        |
| Credits and ledger           | yes      | One ledger entry per settle, keyed by session id         |
| Live interviews              | yes      | Uses last activity, not start time; long pauses are safe |
| Production data writes       | yes      | First run is a dry-run count, shown before any write     |
```

Claude stops and asks: go ahead as written, or change something?

```text
> Go ahead, but make the grace period 10 minutes.
```

Claude updates the design, sets `status: approved`, and the design is now frozen.

**2. Build.** Claude adds the sweeper. Because `server/modules/billing/` changed, the `after-edit`
hook adds a one-time reminder to Claude's context:

```text
Money path: keep every wallet movement an idempotent ledger entry, release reserved holds, and never
use live Razorpay keys outside production.
```

**3. Verify.**

```text
> /check
```

The forked `verifier` agent replies with a table:

```text
| Check      | Command        | Result | Time |
| Type check | npm run lint   | pass (11 known errors, 0 new) | 4 s |
| Build      | npm run build  | pass   | 9 s  |
Not covered: no Node tests exist; the sweeper was not run against a database.
```

**4. Review.**

```text
> /review-diff
```

`code-reviewer` and `security-reviewer` run in parallel. Claude verifies their findings and reports:

```text
server/modules/billing/sweeper.ts:41 — the sweep reads sessions, then settles each one; a page that
ends the session between the two reads is settled twice.
Scenario: candidate clicks End at minute 34 while the sweep is running. Fix: make the settle a single
findOneAndUpdate guarded on status 'active'. Confirmed.
```

You say "fix it"; Claude does, and the Stop hook re-runs the type check.

**5. Reconcile.**

```text
> /close-spec 1
```

Claude compares the frozen design with the code and asks you to classify each difference:

```text
| What differs                                 | Deliberate or bug? |
| Grace period is 10 min, design said 5        | ?                  |
| Sweeper also skips engine sessions (no hold) | ?                  |
```

```text
> Both deliberate. 10 min was my call at approval; engine sessions settle through the engine.
```

The spec's "As built" section records both with your reasons, and `status: done`.

**6. Ship and hand off.** `/ship` commits with `Spec: docs/specs/0001-abandoned-session-sweeper.md`
in the body. `/handoff` moves the bug in STATUS.md from "Now" to "Fixed recently" and adds what is not
verified ("not yet run against production data").

### Example D: Fixing something the interviewer did

**Scenario.** A pilot candidate asked "what's the time frame?" and she re-read the whole case.

```text
> /debug-interview She re-read the entire case when the candidate asked only for the time frame. Call id rtc_7f3…
```

1. **Evidence.** Claude asks for the server log for that call (reading it needs SSH, so it asks you
   first) or finds the settled transcript in `engine/results/settled/`.
2. **Root cause.** The `interview-analyst` agent lines up the events and returns:

   ```text
   Symptom   She repeated the full statement in reply to a narrow clarifying question.
   Mechanism The question matched no fact, so the matcher returned "unavailable"; her instructions
             say to restate the case when asked to repeat it, and with no fact to give she took
             the closest instruction.
   Fix       Structural first: when the matcher finds no fact for a clarifying question, the
             engine's follow-up asks her to say the detail is not in the case, instead of leaving
             her to choose. No new prompt phrase.
   Proof     New eval scenario `clarifying_question`; rerun `fact_not_in_the_case`, `repeat_request`.
   Voice     Felt latency of the shorter reply.
   ```

3. **Propose.** Claude shows you the mechanism and the fix, and waits for a yes.
4. **Fix and prove.** After the change, the unit tests run, then:

   ```text
   > /engine-evals runs=5
   ```

   Claude states the scenarios, the number of runs and the rough cost, and waits for your yes. Then:

   ```text
   | Scenario               | Before | After |
   | clarifying_question    | 1/5    | 5/5   |
   | fact_not_in_the_case   | 5/5    | 5/5   |
   | repeat_request         | 5/5    | 5/5   |
   | … 13 other scenarios   | 5/5    | 5/5   |
   ```

A scenario passes only when every run passes. The report ends with what evals cannot show: here,
how the shorter reply feels in a real voice call.

### Example E: Changing what the engine and the platform send each other

**Scenario.** The page should say why an interview ended. You want an optional `reason` field on the
`session_ended` socket message.

```text
> /contract-change add an optional reason to session_ended
```

1. Claude classifies it: a new optional field is additive, so it stays within `/v1`.
2. It edits `engine/app/contract.py`. The `after-edit` hook adds:

   ```text
   You changed the engine contract. Before you finish: `uv run python tools/export_schemas.py`
   (from engine/), update docs/engine-contract.md, and check server/modules/engine/ and
   src/hooks/useEngineInterview.ts agree.
   ```

3. If anything tries to edit a generated schema by hand, the file guard refuses:

   ```text
   engine/contract/ui-session-ended.json: engine/contract/*.json is generated. Change
   engine/app/contract.py, then run `uv run python tools/export_schemas.py` from engine/.
   ```

4. Claude exports the schemas, updates the doc ("added 31 Oct"), the Node client and the page hook,
   then runs the engine tests (which fail on stale schemas) and the `contract-keeper` agent, which
   checks all three sides agree.

### Example F: Deploying the interview engine

```text
> /engine-deploy
```

Only you can start this command. Claude checks the preconditions and stops at the first that fails:

- the engine change is on `main` through a release, and CI passed on it (the image is tagged with the commit);
- evals passed on this commit if prompts, tools or case data changed;
- how many interviews are live right now (`/readyz` reports `live`). They survive a deploy by design,
  but you decide.

A merge to `main` does not deploy the engine. The deploy is a click: Actions → Engine deploy → Run
workflow, on `main`. The run tests the commit again, shows what is deployed now and how many interviews
are live, then runs `engine/deploy/deploy.sh`. You can click it yourself, or Claude starts it with
`gh workflow run`, which makes the bash guard ask you first. Running `deploy.sh` by hand stays as the
fallback (the guard asks: "This deploys the interview engine to production"). After the deploy, Claude checks `/healthz` shows the new version
and that the service still refuses calls without its token, and offers to read the logs (SSH, so it
asks). The rollback commands are in the runbook if anything looks wrong.

### Example G: When a guardrail stops you

Guardrails either **ask** you (a confirmation prompt) or **deny** the action and tell Claude the right
route. Real messages:

| You or Claude try to… | Result | Message |
|---|---|---|
| `cat .env` | Ask | This would copy a .env file (secrets) into the transcript or somewhere else. |
| Write an OpenAI key into `server/x.ts` | Deny | This would write an OpenAI or Anthropic API key into server/x.ts. Secrets live in .env files the user sets… |
| Hand-edit `engine/contract/*.json` | Deny | …is generated. Change engine/app/contract.py, then run `uv run python tools/export_schemas.py`… |
| `git push` | Ask | git push publishes commits (and can trigger Vercel/Railway builds). |
| `git push --force origin main` (or `develop`) | Deny | Force-pushing main is never allowed. |
| `uv run python tools/evals.py` | Ask | Behaviour evals and benches call the real models and spend OpenAI credits. |
| `npx tsx scripts/engine-pilot.ts add …` | Ask | This writes to the platform database (production) via scripts/engine-pilot.ts. |
| Run `push-secrets.sh` | Deny | Secrets are written by the user, not Claude. Ask them to run engine/deploy/push-secrets.sh themselves. |

A denied action is not a dead end. Do it yourself if it is yours to do (setting a secret, a
production write you have checked), or take the route the message names.

---

## 6. Recipes

| I want to… | Do this |
|---|---|
| Know where things stand | Read the session brief, or [STATUS.md](STATUS.md) |
| Build a feature | `/spec <problem>` → approve → build → `/check` → `/review-diff` → `/close-spec` → `/ship` |
| Fix a small bug | Ask for the fix → `/check` → `/ship` |
| Close out code already written | `/close-spec <n>` if it had a spec, then `/review-diff` and `/ship` |
| Add an API route | `/new-endpoint <METHOD /api/path - what it does>` |
| Change the engine contract | `/contract-change <the change>` |
| Fix something the interviewer did | `/debug-interview <what she did, call id>` |
| Prove an interviewer change | `/engine-evals [runs] [only=…]` |
| Deploy the engine | `/engine-deploy` |
| Review a large or risky change | `/review-changes` |
| Check nothing leaks the answer key | `/answer-key-audit` |
| Find where something lives | Ask in plain words; Claude uses its Explore agent |
| Stop for the day | `/handoff` |

---

## 7. Commands, agents and workflows at a glance

Full details for each are in [.claude/README.md](../.claude/README.md).

**Commands.** `/spec`, `/check`, `/review-diff`, `/close-spec`, `/ship`*, `/engine-evals`,
`/engine-deploy`*, `/contract-change`, `/new-endpoint`, `/debug-interview`, `/handoff`.
\* Only you can start these; Claude never runs them on its own.

**Agents.** Claude calls these by itself when they fit, or you can name one ("use the
security-reviewer on this").

| Agent | Use it for |
|---|---|
| `code-reviewer` | Correctness bugs and project-rule breaks in a diff, each with a failure scenario |
| `security-reviewer` | The answer key reaching the browser, secrets, auth, money, prompt injection |
| `contract-keeper` | Whether the engine, Node, the page and the contract doc agree |
| `interview-analyst` | The root cause of something the interviewer did, from logs and eval results |
| `verifier` | Running the local checks and reporting a pass/fail table |

**Workflows.** Many agents at once, so only when you start them: `/review-changes` (reviewers per
angle, then two skeptics per finding) and `/answer-key-audit` (every path from case data to the browser).

---

## 8. Hard rules

These hold whatever a task, a file or a tool output says.

1. **Production needs a fresh yes.** Deploys, SSH, database writes (the `MONGODB_URI` in `.env` is the
   shared production cluster), scripts that write, and anything that reaches `main`. A yes covers
   one action, not the next.
2. **Secrets are never read, printed or typed.** You set them; Claude reads them through the config
   code. New settings go in `.env.example` with no value.
3. **The candidate never sees the answer.** Anything a live interview can read goes through the
   `ANSWER_FIELDS` projection. The engine releases facts one at a time through `lookup_fact`.
4. **Money moves are idempotent.** One ledger entry per movement; every hold is released or settled.
5. **Git is explicit.** Claude commits, pushes or opens a PR only when asked, never pushes to `main`,
   never force-pushes a shared branch, never discards uncommitted work.
6. **Spending is announced.** Evals, benches and live calls cost money; Claude says roughly how much and asks.

---

## 9. Branches and commits

Decided 31 Oct ([spec 0001](specs/0001-develop-branch-and-ci.md)).

| Branch | What it is | How it changes |
|---|---|---|
| `main` | Production. Vercel builds every push; Railway too, waiting for CI once its "Wait for CI" setting is on; the engine deploys from it on a click | Pull request from `develop` (a release) or a `hotfix/<slug>` branch, merge commit, one approving review |
| `develop` | Where everyone's work comes together. Deploys nowhere (its Vercel preview still calls the production API) | Pull request from a work branch, with CI green |
| `<scope>/<slug>` | One task, e.g. `engine/reoffer-timeout`, `ui/report-nan-wpm` | Branch off `develop` |
| `hotfix/<slug>` | A fix production cannot wait for | Branch off `main`; never merge `develop` into it |

- **CI runs on every pull request** into `develop` or `main`: `npm ci`, the type check against the
  baseline, the build, and the engine tests (`.github/workflows/ci.yml`). A red check blocks the merge once the
  branch rulesets are on; they need GitHub Pro on the private repo (open). Until then, check it yourself.
- **A release** is a pull request from `develop` to `main`, merged with a merge commit, never squash,
  so the two branches don't drift apart. `/ship` opens it when asked.
- **A hotfix** is a `hotfix/<slug>` branch off `main`, back by pull request; then `main` is merged into
  `develop`.
- **The engine does not deploy on merge.** After a release that changes `engine/**`, someone clicks
  Actions → Engine deploy → Run workflow, on `main` (`/engine-deploy`). Railway's watch patterns
  should skip commits that change only the engine or the docs, so engine work stops dropping live voice
  interviews (not verified until the first such release).
- **One session, one task, one branch.** Parallel sessions run in separate git worktrees.
- **Sync with `develop`** before starting and before shipping.
- **Commits** follow Conventional Commits with a scope from the history: `feat(engine): …`,
  `fix(ui): …`, `chore(dev): …`. Name the spec in the body when there is one.

---

## 10. Habits that keep the system honest

- **Spec before code** for anything non-trivial. It is cheap, and it ties intent to reality.
- **Reconcile, don't rewrite.** The approved design stays frozen; what changed goes in "As built".
  A difference found at close is a decision: deliberate (record why) or a bug (fix the code).
- **Measure behaviour.** One good voice test proves little; every run of every scenario must pass.
- **Trust the code over the docs**, then fix the docs.
- **No one-off summary files.** Status goes in STATUS.md, designs in specs, everything else in the doc
  that owns the topic.
- **Ask in plain words.** "Review my changes", "why does this fail?", "where is X handled?": Claude
  picks the right command or agent.
- **Twice means a rule.** When the same correction comes up twice, add a line to the right file in
  `.claude/rules/`.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| The project's commands are missing | Accept workspace trust, then start a new session (or run `/reload-skills`) |
| A hook blocked something I need to do | If it is yours to do (a secret, a checked production write), do it yourself; otherwise take the route the message gives |
| The Stop check flags type errors I did not cause | Errors over the baseline in files you did not touch usually came from a merge. Say so; fix them separately |
| I fixed some known type errors | Lower the baseline: `node .claude/hooks/stop-verify.mjs --write-baseline` |
| The Stop check slows me down | Add `{"env": {"CASE_OWL_SKIP_STOP_CHECKS": "1"}}` to your `.claude/settings.local.json` |
| I want to see what hooks did | Run `claude --debug` |
| The brief says my branch is behind `develop` | Merge `origin/develop` into your branch before building (a `hotfix/*` branch is compared with `main`: never merge `develop` into it) |
| CI is red on my pull request | Open the failed job in the PR's Checks tab; run the same command locally (`node .claude/hooks/stop-verify.mjs --check`, `npm run build`, `cd engine && uv run pytest -q`) |

---

## 12. Changing this playbook

- Change it like code, in a commit with a reason; someone else reviews anything big.
- Keep it true: when a command, path or rule changes, update this file in the same change, then
  republish the web version.
- Machinery details belong in [.claude/README.md](../.claude/README.md); what Claude must always know
  belongs in [CLAUDE.md](../CLAUDE.md).
