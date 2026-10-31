// Shared helpers for the project's Claude Code hooks. Each hook reads one JSON event on stdin and
// answers on stdout (https://code.claude.com/docs/en/hooks). Hooks fail open: a crash never blocks work.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

export async function readInput() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

/** A path relative to the repo root, with forward slashes; absolute if it is outside the repo. */
export function rel(p) {
  if (!p) return '';
  const abs = path.resolve(projectDir, p);
  const r = path.relative(projectDir, abs);
  return r.startsWith('..') ? abs : r.split(path.sep).join('/');
}

/** PreToolUse answer: 'deny' blocks the call and tells Claude why; 'ask' makes the user confirm. */
export function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}

const stateDir = path.join(tmpdir(), 'case-owl-claude-hooks');

/** True the first time a key is seen in this session, so a reminder is given once, not on every edit. */
export function firstTime(sessionId, key) {
  mkdirSync(stateDir, { recursive: true });
  const marker = path.join(stateDir, `${sessionId || 'nosession'}-${key}`.replace(/[^\w.-]/g, '_'));
  if (existsSync(marker)) return false;
  writeFileSync(marker, '');
  return true;
}

export function stateFile(name) {
  mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, name);
}
