# Claude Code setup: reference

What each part of the team's Claude Code setup is and does: the rules, commands, agents, workflows,
hooks and settings in this folder. For how we work with it (the loop, worked examples, recipes and
first-time setup), read the playbook: [docs/PLAYBOOK.md](../docs/PLAYBOOK.md).

Set up 31 Oct 2026. What Claude loads in every session is [CLAUDE.md](../CLAUDE.md) at the repo root;
this file is for people and Claude does not load it.

## What is in here

```
CLAUDE.md                     always loaded: map, where the truth lives, commands, the loop, hard rules
docs/PLAYBOOK.md              how the team works: the loop, worked examples, recipes, setup
docs/STATUS.md                what is live, moving and open; its "Now" list opens every session
docs/specs/                   one spec per non-trivial change: design, then "As built"
.worktreeinclude              .env files copied into Claude's worktrees so the app runs there
.claude/
├── README.md                 this reference (for people; Claude does not load it)
├── settings.json             permissions and hook wiring (shared)
├── rules/                    loaded by path, when Claude works in that part of the code
├── skills/<name>/SKILL.md    slash commands: /spec, /check, /review-diff, /close-spec, /ship, …
├── agents/<name>.md          specialist subagents: reviewers, verifier, interview analyst
├── workflows/<name>.js       multi-agent runs: /review-changes, /answer-key-audit
├── hooks/                    Node scripts the harness runs around Claude's actions
└── agent-memory/             what the interview-analyst agent has learned (shared)
```

## 1. CLAUDE.md and STATUS.md: what every session starts with

[CLAUDE.md](../CLAUDE.md) sits at the repo root, where Claude Code and people both look first. It holds
what Claude must know in every session, kept short so it stays cheap and gets read: the three codebases
and where each deploys, the "where the truth lives" table, the commands, the loop, the definition of
done, the hard rules, conventions, and who works where.

The hard rules, in short: production actions (deploys, SSH, database writes, anything reaching `main`)
need a fresh yes; secrets are never read or typed; the candidate never sees the answer key; money moves
are idempotent; nothing is committed, pushed or opened as a PR unless asked; paid model calls are
announced and asked for.

[docs/STATUS.md](../docs/STATUS.md) is the one place for what is live, what is moving, fixed recently,
decisions to make and what is next. A SessionStart hook prints its "Now" list, so keep that list to the
five or so things a new session must know. `/handoff` keeps it current.

## 2. Rules: knowledge that loads when it is needed

Rules with `paths:` load only when Claude reads or edits a matching file, so the engine's rules cost
nothing during a frontend task. Only the security rule is always on.

| File | Loads when Claude touches | Covers |
|---|---|---|
| [security.md](rules/security.md) | always | Answer key, secrets, auth and ownership, production data, money, untrusted uploads |
| [engine.md](rules/engine.md) | `engine/**` | Settled design decisions, uv and pytest, hand-off safety, deploy rules |
| [interviewer-behaviour.md](rules/interviewer-behaviour.md) | engine runtime, cases, evals, `server/ai/`, `server/modules/voice/` | Her persona, judgment over rules, root cause → structural fix → repeated evals |
| [engine-contract.md](rules/engine-contract.md) | the contract on all three sides | Additive-only within `/v1`, change order, schemas never hand-edited |
| [backend.md](rules/backend.md) | `server/`, `server.ts`, `scripts/` | Module shape (routes, controller, service), zod, ESM imports, Mongoose 9 traps |
| [frontend.md](rules/frontend.md) | `src/`, `vite.config.ts` | Feature-folder pattern, `lib/api.ts`, nothing secret in the bundle, look-and-feel checks |
| [docs-and-writing.md](rules/docs-and-writing.md) | `docs/`, READMEs, CLAUDE.md, `.claude/**/*.md` | Plain English, dated decisions, honest verified lists, no one-off summary files, frozen spec designs |

## 3. Skills: the slash commands

Skills are today's form of custom slash commands (`.claude/commands/*.md` still works, but skills can
carry their own files and run in a fork). "You only" means Claude cannot start it on its own.

| Command | Who can start it | Use it to |
|---|---|---|
| `/spec [change]` | you or Claude | Write a spec to `docs/specs/NNNN-slug.md` (or in chat for small changes) and wait for a yes |
| `/check [scope]` | you or Claude | Run the gates for what changed in a forked `verifier`, get a pass/fail table |
| `/review-diff [target]` | you or Claude | Run `code-reviewer`, plus `security-reviewer` and `contract-keeper` when they apply, in parallel; verify and merge findings |
| `/close-spec [n]` | you or Claude | Compare the spec's design with the code, draft "As built", have you mark each deviation deliberate or bug |
| `/ship [what]` | you only | Sync with `main`, check, review, conventional commit, push, and a PR into `main` if you want one |
| `/engine-evals [runs] [only]` | you or Claude (asks before spending) | Run the interviewer's behaviour evals and compare with the last run |
| `/engine-deploy` | you only | Deploy the engine to production with preconditions, health checks and rollback steps |
| `/contract-change [change]` | you or Claude | Change the engine ⇄ platform contract on all three sides in the right order |
| `/new-endpoint [METHOD path]` | you or Claude | Add a Node API route the codebase's way, then exercise it (401, 403/404, 400) |
| `/debug-interview [what she did]` | you or Claude | Evidence → `interview-analyst` → structural fix → evals |
| `/handoff` | you or Claude | Update STATUS.md, specs and verified lists, write the handoff note, list loose ends |

## 4. Agents: specialists with their own context

Subagents run in their own context window and return only their conclusion, so a long review does not
crowd the main conversation. Claude delegates to them by their description, or you can ask for one
by name ("use the security-reviewer on this").

| Agent | Model | Does |
|---|---|---|
| [code-reviewer](agents/code-reviewer.md) | session's | Correctness bugs and project-rule breaks in a diff, each verified with a concrete failure scenario. Read-only |
| [security-reviewer](agents/security-reviewer.md) | session's | Traces data: answer key to the browser, secrets, auth and ownership, money, prompt injection from uploads. Read-only |
| [contract-keeper](agents/contract-keeper.md) | session's | Checks engine, Node, page and the contract doc agree. Read-only |
| [interview-analyst](agents/interview-analyst.md) | session's | Root-causes interviewer behaviour from logs and eval results; never spends money; keeps a shared memory of mechanisms found |
| [verifier](agents/verifier.md) | Sonnet | Runs the local, free checks and reports a table. Never fixes anything |

The reviewers get the code, not the author's opinion of it, so their read is independent. For finding
code, Claude Code's built-in Explore agent already does the job.

## 5. Workflows: many agents for the big jobs

Saved Workflow scripts orchestrate several agents with fixed control flow. They cost far more than
one review, so they run only when you start them.

| Command | Does | When |
|---|---|---|
| `/review-changes [target]` | Scopes the diff, runs one reviewer per angle that applies (correctness, security, contract, interviewer behaviour), then two skeptics try to refute each finding. Returns confirmed, disputed and unverified findings | Before shipping engine, contract, billing, auth or voice changes |
| `/answer-key-audit` | Maps every place case data can reach the browser, audits each with the security reviewer, has a skeptic re-check each exposure | Before widening the pilot or launch; after changes to cases, sessions, reports, sockets |

## 6. Hooks: guardrails the harness enforces

Instructions can be forgotten; hooks run every time. They are Node scripts in [hooks/](hooks/),
wired in [settings.json](settings.json). "Ask" shows you a confirmation prompt; "deny" stops the action
and tells Claude why, so it can take the right route.

| Hook | When | What it does |
|---|---|---|
| [session-brief.mjs](hooks/session-brief.mjs) | session start | Prints the branch, commits behind/ahead of `origin/main` (as of the last fetch; no network), uncommitted changes, and the "Now" list from `docs/STATUS.md`. Warns when on `main` or behind it |
| [guard-bash.mjs](hooks/guard-bash.mjs) | before any shell command | **Deny**: `push-secrets.sh`, force-push to `main`, `rm -r` of the repo or a top-level folder, reading private SSH keys. **Ask**: any `git push`, history-destroying git (`reset --hard`, `clean -f`, `checkout .`, `branch -D`), `deploy.sh`, `ssh`/`scp`, pilot scripts that write the database, `mongosh`, evals and benches (they cost money), printing a `.env` file or a secret variable |
| [guard-files.mjs](hooks/guard-files.mjs) | before any file write | **Deny**: `.env` files, generated `engine/contract/*.json`, lockfiles, `dist/`, `node_modules/`, `.git/`, and any content holding an API key, private key, token or a Mongo URI with a real password. **Ask**: changes to `.claude/settings.json` or `.claude/hooks/` (the guardrails themselves) |
| [after-edit.mjs](hooks/after-edit.mjs) | after any file write | Rejects JSON that does not parse and Python that does not compile. Once per session per area, reminds Claude of that area's obligations: contract (export schemas, update the doc), interviewer behaviour (evals), platform prompts (live users), case data (answer fields), money, new env settings |
| [stop-verify.mjs](hooks/stop-verify.mjs) | when Claude is about to finish a turn | If code changed: `tsc` must add no errors beyond [tsc-baseline.json](hooks/tsc-baseline.json), and if the engine changed `uv run pytest` must pass. On failure Claude is sent back once to fix it or say plainly why not. A tree that already passed is not re-checked. Adds about 4 s (types), 8 s (engine) or 12 s (both) |

**The type-error baseline.** The repo had 11 type errors in 8 files on 31 Oct (pre-existing, mostly
`key` props on typed components). They are recorded per file and error code so that new errors fail
and old ones do not. When you fix some, lower the baseline:
`node .claude/hooks/stop-verify.mjs --write-baseline`. Never raise it to make new errors pass.

**Switching things off.** Personal, in `.claude/settings.local.json` (gitignored):
`{"env": {"CASE_OWL_SKIP_STOP_CHECKS": "1"}}` turns off the Stop check; `"disableAllHooks": true`
turns off every hook. `claude --debug` shows each hook run.

**What hooks are not.** A guardrail against honest mistakes, not a security boundary: a determined
command can get past a pattern. Real protection for production is in the credentials themselves (the
deploy key, Atlas users, Railway and Vercel access).

## 7. Settings and permissions

[settings.json](settings.json) (shared):

- **Allow** without a prompt: `npm run lint`, `npm run build`, `tsc --noEmit`, read-only git
  (`status`, `diff`, `log`, `show`), `uv run pytest`, exporting the contract schemas.
- **Deny** reading or editing `.env`, `.env.local`, `.env.*.local`, `.env.production`, `.env.development`
  at any depth, and reading `~/.ssh`.
- The five hooks above.

Your own preferences go in `.claude/settings.local.json`, which overrides the shared file and is never
committed. For example, to skip the prompt for the dev servers:

```json
{ "permissions": { "allow": ["Bash(npm run dev)", "Bash(npm run server:dev)"] } }
```

Personal notes Claude should know about only on your machine go in `CLAUDE.local.md` at the repo root
(also gitignored).

## 8. Memory: what is shared and what is not

| Kind | Where | Shared? | Holds |
|---|---|---|---|
| Project brief and rules | `CLAUDE.md`, `.claude/rules/` | yes, in git | How we work, and what is true about the code |
| Status and specs | `docs/STATUS.md`, `docs/specs/` | yes, in git | What is live and open; what each change was meant to be and what it became |
| Agent memory | `.claude/agent-memory/interview-analyst/` | yes, in git | Interviewer failure mechanisms found so far, seeded from the spike's root-cause tables |
| Your auto memory | `~/.claude/projects/<repo>/memory/` | no, your machine | What Claude learned working with you |

If something matters to the next person, it goes in the repo, not in anyone's private memory. If the
same correction comes up twice, it becomes a line in the right rule file.

## Changing this setup

- Treat it like code: change it in a commit with a reason, reviewed by someone else for anything big.
- Add a rule when Claude makes the same mistake twice, in the rule file for that area. Keep CLAUDE.md
  short; move detail into rules or skills.
- When a command, path or decision in here changes, update it in the same change as the code.
- Claude must ask before editing `settings.json` or `hooks/` (a hook enforces it).

## Verified, and not yet

Verified on 31 Oct 2026:
- Every agent, skill and rule file parses, with the required frontmatter; `settings.json` is valid JSON;
  both workflow scripts pass a syntax check.
- A fresh headless session in the repo (Claude Code 2.1.310) loaded CLAUDE.md, the always-on security
  rule, all five agents, the model-invocable skills and both workflows as commands; the path-scoped
  rules stayed unloaded until a matching file was touched.
- The hooks: 49 sample commands and writes give the expected allow, ask or deny; a deliberate type
  error and a failing engine test are both caught at Stop, and `stop_hook_active` prevents a loop; the
  session brief prints the branch, the gap to `main` and the "Now" list.

Not verified yet:
- A full run of each skill and workflow on a real change.
- The setup on Dhrumil's and Himanshu's machines (Node and `uv` versions, workspace trust).
