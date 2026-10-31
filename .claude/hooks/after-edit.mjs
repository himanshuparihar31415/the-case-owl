#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): fast checks on the file just written, and a one-time reminder when
// an edit lands in an area with its own obligations (the contract, the interviewer's behaviour, money).
// Slower checks (type check, engine tests) run once per turn in stop-verify.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readInput, rel, firstTime, projectDir } from './_lib.mjs';

const input = await readInput();
const file = rel(input.tool_input?.file_path ?? '');
const abs = path.resolve(projectDir, file);
if (!file || !existsSync(abs)) process.exit(0);

const problems = [];

if (file.endsWith('.json')) {
  try {
    JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    problems.push(`${file} is not valid JSON: ${e.message}`);
  }
}

if (file.endsWith('.py')) {
  const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])', abs], { encoding: 'utf8' });
  if (r.status !== 0 && !r.error) problems.push(`${file} does not parse:\n${(r.stderr || '').trim().split('\n').slice(-6).join('\n')}`);
}

const REMINDERS = [
  ['contract', /^engine\/app\/contract\.py$/,
    'You changed the engine contract. Before you finish: `uv run python tools/export_schemas.py` (from engine/), update docs/engine-contract.md, and check server/modules/engine/ and src/hooks/useEngineInterview.ts agree. /contract-change has the checklist.'],
  ['behaviour', /^engine\/(app\/runtime\/(prompts|facts|guard|turns|interview)\.py|cases\/.+\.json)$/,
    'This changes how the interviewer behaves. Unit tests do not prove behaviour: plan an eval run (`uv run python tools/evals.py --runs 5`, ask first, it costs money) and list what still needs a voice test.'],
  ['platform-prompts', /^server\/(ai\/|modules\/voice\/)/,
    'This changes the live interviews every non-pilot user gets at the next Railway deploy. Check it with a real session or scripts/test_eval.ts, and say what was not tested.'],
  ['answer-key', /^server\/(models\/Case\.ts|modules\/(cases|sessions|reports|engine)\/)/,
    'Case data is in play: anything a live interview can read must go through the ANSWER_FIELDS projection (server/models/Case.ts). New solution fields go into ANSWER_FIELDS in the same change.'],
  ['money', /^server\/(modules\/billing\/|models\/(Wallet|LedgerEntry|PaymentIntent|Plan)\.ts)/,
    'Money path: keep every wallet movement an idempotent ledger entry, release reserved holds, and never use live Razorpay keys outside production.'],
  ['env', /^(server\/config\/env\.ts|engine\/app\/config\.py)$/,
    'New setting? Add it to .env.example (or engine/deploy/env.example) with a comment and no real value, and tell the user which value to set where (local .env, Railway, Vercel, the server).'],
];

const notes = REMINDERS
  .filter(([key, re]) => re.test(file) && firstTime(input.session_id, key))
  .map(([, , note]) => note);

// A broken file is fed back as a block (Claude sees it next to the tool result); reminders are plain
// context. The docs do not say both may share one answer, so a block carries the reminders in its reason.
if (problems.length) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: [...problems, ...notes].join('\n\n') }));
} else if (notes.length) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } }));
}
process.exit(0);
