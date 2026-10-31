#!/usr/bin/env node
// Stop: before Claude ends a turn with uncommitted changes, run the gates for what changed.
//   - any .ts/.tsx changed: `tsc --noEmit`, and no error count may rise above tsc-baseline.json
//   - engine code, tests or cases changed: `uv run pytest -q -x` in engine/
// A failure sends Claude back to fix it (once per stop, so it can never loop). A passing state is
// remembered, so an unchanged tree is not checked twice.
//
// Set CASE_OWL_SKIP_STOP_CHECKS=1 (e.g. in .claude/settings.local.json "env") to switch this off.
// `node .claude/hooks/stop-verify.mjs --write-baseline` rewrites the baseline from today's errors:
// do that only after fixing errors, never to make new ones pass.
// `node .claude/hooks/stop-verify.mjs --check` is the same type-check rule for CI (.github/workflows/ci.yml):
// it prints the errors above the baseline and exits 1 if there are any.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readInput, projectDir, stateFile } from './_lib.mjs';

const BASELINE = path.join(projectDir, '.claude/hooks/tsc-baseline.json');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 32 << 20, ...opts });

function typeErrors() {
  const tsc = path.join(projectDir, 'node_modules/.bin/tsc');
  if (!existsSync(tsc)) return null;
  const r = run(tsc, ['--noEmit', '-p', '.'], { timeout: 120_000 });
  const counts = {};
  const lines = [];
  const unplaced = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+):/);
    if (!m) {
      if (/\berror TS\d+:/.test(line)) unplaced.push(line);
      continue;
    }
    const [, file, code] = m;
    counts[file] ??= {};
    counts[file][code] = (counts[file][code] ?? 0) + 1;
    lines.push(line);
  }
  // A failure the per-file counts cannot show: tsc did not run or was killed (the timeout), or it reported
  // an error with no file position (a tsconfig error, say), which stops it checking anything else.
  let failed = '';
  if (r.error || r.signal) failed = `tsc did not finish (${r.error?.message ?? r.signal})`;
  else if (unplaced.length) failed = unplaced.slice(0, 10).join('\n');
  else if (r.status !== 0 && !lines.length) {
    failed = `tsc exited ${r.status} without a readable error:\n${`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-10).join('\n')}`;
  }
  return { counts, lines, failed };
}

/** The [file, code] pairs that now occur more often than tsc-baseline.json allows, and their error lines. */
function errorsOverBaseline(t) {
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const over = [];
  for (const [file, codes] of Object.entries(t.counts)) {
    for (const [code, n] of Object.entries(codes)) {
      if (n > (baseline[file]?.[code] ?? 0)) over.push([file, code]);
    }
  }
  const lines = t.lines.filter((l) => over.some(([file, code]) => l.startsWith(`${file}(`) && l.includes(`error ${code}:`)));
  return { over, lines };
}

if (process.argv.includes('--write-baseline')) {
  const t = typeErrors();
  if (!t) throw new Error('node_modules/.bin/tsc not found: run npm install first');
  if (t.failed) throw new Error(`the type check did not run cleanly, so there is no baseline to write:\n${t.failed}`);
  writeFileSync(BASELINE, JSON.stringify(t.counts, null, 2) + '\n');
  console.log(`baseline: ${t.lines.length} known type errors in ${Object.keys(t.counts).length} files`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  const t = typeErrors();
  if (!t) throw new Error('node_modules/.bin/tsc not found: run npm ci first');
  if (t.failed) {
    console.log(`The type check did not run cleanly:\n${t.failed}`);
    process.exit(1);
  }
  const { over, lines } = errorsOverBaseline(t);
  if (over.length) {
    console.log(`New TypeScript errors (beyond the known ones in .claude/hooks/tsc-baseline.json):\n${lines.join('\n')}`);
    process.exit(1);
  }
  console.log(`type check: no errors beyond the baseline (${t.lines.length} known)`);
  process.exit(0);
}

const input = await readInput();
if (input.stop_hook_active || process.env.CASE_OWL_SKIP_STOP_CHECKS === '1') process.exit(0);

const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all']);
if (status.status !== 0) process.exit(0);
const changed = status.stdout.split('\n').filter(Boolean)
  .filter((l) => !l.startsWith(' D') && !l.startsWith('D '))
  .map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));

const tsChanged = changed.some((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith('node_modules/'));
const engineChanged = changed.some((f) => /^engine\/(app|tests|tools|cases)\/.+\.(py|json)$/.test(f) || /^engine\/(pyproject\.toml|uv\.lock)$/.test(f));
if (!tsChanged && !engineChanged) process.exit(0);

// Fingerprint of the working tree, so a tree that already passed is not checked again.
const hash = createHash('sha1').update(run('git', ['diff', 'HEAD']).stdout || '');
for (const f of changed) {
  try { hash.update(`${f}:${statSync(path.join(projectDir, f)).mtimeMs}`); } catch { /* removed meanwhile */ }
}
const okMarker = stateFile(`stop-ok-${hash.digest('hex')}`);
if (existsSync(okMarker)) process.exit(0);

const failures = [];

if (tsChanged) {
  const t = typeErrors();
  if (t?.failed) {
    failures.push(`The type check did not run cleanly (npm run lint):\n${t.failed}`);
  } else if (t) {
    const { over, lines } = errorsOverBaseline(t);
    if (over.length) {
      failures.push(`New TypeScript errors (beyond the known ones in .claude/hooks/tsc-baseline.json):\n${lines.slice(0, 25).join('\n')}`);
    }
  }
}

if (engineChanged) {
  const engineDir = path.join(projectDir, 'engine');
  const r = run('uv', ['run', 'pytest', '-q', '-x', '--no-header', '-p', 'no:cacheprovider'], { cwd: engineDir, timeout: 150_000 });
  if (r.error?.code === 'ENOENT') {
    // uv is not installed here: nothing to run, and nothing to claim either.
  } else if (r.status !== 0) {
    const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-30).join('\n');
    failures.push(`Engine tests fail (cd engine && uv run pytest -q -x):\n${tail}`);
  }
}

if (failures.length) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `${failures.join('\n\n')}\n\nFix these before finishing. If they were there before your change, or this turn deliberately leaves work in progress, say so plainly in your reply instead.`,
  }));
  process.exit(0);
}

writeFileSync(okMarker, '');
process.exit(0);
