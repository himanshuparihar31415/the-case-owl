#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): files Claude must not write, files that are generated,
// and secrets pasted into code. The reasons are written for Claude, so it can take the right route.
import { readInput, decide, rel } from './_lib.mjs';

const input = await readInput();
const ti = input.tool_input ?? {};
const file = rel(ti.file_path ?? ti.notebook_path ?? '');

const DENY_PATHS = [
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, 'Secret files are edited by the user, never by Claude. Put the variable\'s name and a comment in .env.example (or engine/deploy/env.example) and ask the user to set the value.'],
  [/^engine\/contract\/.+\.json$/, 'engine/contract/*.json is generated. Change engine/app/contract.py, then run `uv run python tools/export_schemas.py` from engine/.'],
  [/(^|\/)package-lock\.json$/, 'Lockfiles change only through npm install. Ask before adding or upgrading a dependency.'],
  [/^engine\/uv\.lock$/, 'Lockfiles change only through uv add / uv lock. Ask before adding or upgrading a dependency.'],
  [/^(dist|node_modules|engine\/\.venv|engine\/results)\//, 'This folder is build output or local data, not source.'],
  [/(^|\/)\.git\//, 'Never write inside .git.'],
  [/(^|\/)\.ssh\//, 'Never write SSH keys or config.'],
];

for (const [re, reason] of DENY_PATHS) {
  if (re.test(file)) decide('deny', `${file}: ${reason}`);
}

// The guardrails themselves: changing them is the user's call, so they see it happen.
if (/^\.claude\/(settings\.json|hooks\/)/.test(file)) {
  decide('ask', `${file} is one of the team's guardrails (hooks, permissions, the type-error baseline). Confirm this change.`);
}

// A workflow pushed on any branch runs with the repo's secrets, including the engine server's root key.
if (/^\.github\//.test(file)) {
  decide('ask', `${file} is a GitHub Actions file: workflows can read the repo's secrets, including the engine server's deploy key (ENGINE_SSH_KEY). Confirm this change.`);
}

const written = [ti.content, ti.new_string, ti.new_source, ...(ti.edits ?? []).map((e) => e.new_string)]
  .filter((s) => typeof s === 'string')
  .join('\n');

const PLACEHOLDER = /^(<.*>|\$\{.*\}|\{\{.*\}\}|x+|\*+|\.{3}|password|pass|pwd|secret|changeme|example)$/i;
const SECRETS = [
  ['an OpenAI or Anthropic API key', /\bsk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{32,}/],
  ['an ElevenLabs API key', /\bsk_[a-f0-9]{40,}\b/],
  ['a private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a signed JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

for (const [what, re] of SECRETS) {
  if (re.test(written)) {
    decide('deny', `This would write ${what} into ${file}. Secrets live in .env files the user sets; read them through server/config/env.ts or engine/app/config.py.`);
  }
}
for (const m of written.matchAll(/mongodb(?:\+srv)?:\/\/([^:\s\/@'"`]+):([^@\s'"`]+)@/g)) {
  if (!PLACEHOLDER.test(m[2]) && !m[2].includes('<')) {
    decide('deny', `This would write a MongoDB connection string with a real password into ${file}. Use MONGODB_URI from the environment.`);
  }
}

process.exit(0);
