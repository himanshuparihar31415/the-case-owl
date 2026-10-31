#!/usr/bin/env node
// SessionStart: a short brief at the top of every session, so work starts from where things stand:
// the branch, how far it is from main (as of the last fetch; this never touches the network),
// uncommitted changes, and the "Now" list from docs/STATUS.md. Plain stdout becomes Claude's context.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readInput, projectDir } from './_lib.mjs';

await readInput();
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

const lines = ['Session brief (.claude/hooks/session-brief.mjs):'];
const branch = git('branch', '--show-current') || '(detached HEAD)';
lines.push(`- Branch: ${branch}`);

if (branch === 'main') lines.push('- You are on main, which is production. Branch off before changing anything.');

const counts = git('rev-list', '--left-right', '--count', 'origin/main...HEAD');
if (counts) {
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  let fetched = '';
  try {
    const days = (Date.now() - statSync(path.join(projectDir, '.git/FETCH_HEAD')).mtimeMs) / 86_400_000;
    fetched = days < 1 ? ' (fetched today)' : ` (last fetch ${Math.floor(days)} days ago; run git fetch)`;
  } catch { /* never fetched */ }
  if (behind) lines.push(`- ${behind} commits behind origin/main, ${ahead} ahead${fetched}. Bring the branch up to date before building or shipping.`);
  else if (branch !== 'main') lines.push(`- Up to date with origin/main, ${ahead} commits ahead${fetched}.`);
}

const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
if (dirty) lines.push(`- ${dirty} uncommitted changes in the working tree (someone's work in progress: do not discard).`);

const status = path.join(projectDir, 'docs/STATUS.md');
if (existsSync(status)) {
  const text = readFileSync(status, 'utf8');
  const now = text.match(/^## Now\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim();
  const updated = text.match(/^Last updated: (.+)$/m)?.[1];
  if (now) lines.push('', `Now, from docs/STATUS.md${updated ? ` (updated ${updated})` : ''}:`, now);
}

process.stdout.write(lines.join('\n') + '\n');
