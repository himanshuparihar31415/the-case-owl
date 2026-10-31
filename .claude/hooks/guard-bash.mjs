#!/usr/bin/env node
// PreToolUse(Bash): commands that touch production, secrets, money or shared history need the user.
// "deny" stops the command and tells Claude why; "ask" shows the user a confirmation prompt.
// The rules behind each line are in CLAUDE.md ("Hard rules") and .claude/rules/security.md.
import { readInput, decide } from './_lib.mjs';

const input = await readInput();
const command = String(input.tool_input?.command ?? '');

// Heredoc bodies are text (commit messages, PR bodies), not commands.
const text = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '');
const segments = text.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);

const deny = [];
const ask = [];

// A file that holds secrets: .env, .env.local, engine/.env … but not .env.example.
const SECRET_FILE = /(^|[\s'"=\/])\.env(\.(?!example\b)[\w.-]+)?(?=$|[\s'"])/;
const PRINTERS = /^(cat|less|more|head|tail|bat|grep|egrep|rg|sed|awk|strings|xxd|od|base64|pbcopy|diff|cp|open|code|vim?|nano)$/;

function commandWord(seg) {
  const words = seg.replace(/^[({]\s*/, '').split(/\s+/);
  let i = 0;
  while (i < words.length && (/^\w+=/.test(words[i]) || ['sudo', 'time', 'command', 'nohup', 'exec'].includes(words[i]))) i++;
  return { word: (words[i] ?? '').replace(/^.*\//, ''), args: words.slice(i + 1) };
}

for (const seg of segments) {
  const { word, args } = commandWord(seg);

  if (/\bpush-secrets\.sh\b/.test(seg)) {
    deny.push('Secrets are written by the user, not Claude. Ask them to run engine/deploy/push-secrets.sh themselves.');
  }

  if (word === 'git' && args[0] === 'push') {
    const force = args.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || /^\+/.test(a));
    const toMain = args.some((a) => /(^|:|\+)(main|master)$/.test(a));
    if (force && toMain) deny.push('Force-pushing main is never allowed.');
    else if (force) ask.push('Force-push rewrites history that teammates may have pulled.');
    else if (toMain) ask.push('Pushing straight to main: the team ships to main through pull requests.');
    else ask.push('git push publishes commits (and can trigger Vercel/Railway builds).');
  }

  if (word === 'git') {
    const sub = args.join(' ');
    if (/^reset\b.*--hard/.test(sub)
      || /^clean\b.*-\w*f/.test(sub)
      || /^(checkout|restore)\s+(--\s+)?\.$/.test(sub)
      || /^stash\s+(drop|clear)\b/.test(sub)
      || /^branch\s+-D\b/.test(sub)) {
      ask.push(`"git ${sub}" throws away work that may not be saved anywhere else.`);
    }
  }

  if (word === 'rm' && args.some((a) => /^-\w*r/.test(a) || a === '--recursive')) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.some((t) => /^["']?(\/|~\/?|\$HOME\/?|\.\/?|\.\.\/?|\*|\.git\/?|\.claude\/?|engine\/?|server\/?|src\/?|docs\/?)["']?$/.test(t))) {
      deny.push(`"${seg}" would delete the repo, a top-level folder, or more. Delete specific paths instead.`);
    }
  }

  if (/\bdeploy\/deploy\.sh\b/.test(seg)) {
    ask.push('This deploys the interview engine to production (srv2011824.hstgr.cloud).');
  }

  if (['ssh', 'scp', 'rsync', 'sftp'].includes(word)) {
    ask.push('This runs against a remote machine (the production engine server, if it is the deploy key).');
  }

  if (/\bengine-pilot\.ts\s+(setup|add|remove)\b/.test(seg)) {
    ask.push('This writes to the platform database (production) via scripts/engine-pilot.ts.');
  }

  if (['mongosh', 'mongo', 'mongodump', 'mongorestore', 'mongoimport', 'mongoexport'].includes(word)) {
    ask.push('This connects to MongoDB; the URI in .env is the shared production cluster.');
  }

  if (/\b(evals|bench)\.py\b/.test(seg)) {
    ask.push('Behaviour evals and benches call the real models and spend OpenAI credits.');
  }

  if (PRINTERS.test(word) && args.some((a) => SECRET_FILE.test(a))) {
    ask.push('This would copy a .env file (secrets) into the transcript or somewhere else.');
  }
  if (PRINTERS.test(word) && args.some((a) => /\.ssh\/(?!.*\.pub\b)[\w.-]+/.test(a))) {
    deny.push('Private SSH keys are never read or copied.');
  }
  if ((word === 'printenv' || word === 'env') && args.length === 0) {
    ask.push('This prints every environment variable, which may include API keys.');
  }
  if ((word === 'echo' || word === 'printf') && /\$\{?\w*(KEY|SECRET|TOKEN|PASSWORD|MONGO\w*URI)\w*\}?/.test(seg)) {
    ask.push('This would print a secret from the environment.');
  }
}

if (deny.length) decide('deny', [...new Set(deny)].join(' '));
if (ask.length) decide('ask', [...new Set(ask)].join(' '));
process.exit(0);
