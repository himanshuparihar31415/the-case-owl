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

// git's global options come before the subcommand: `git -C dir push …` is still a push.
function gitSubcommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i]) ? 2 : 1;
  }
  return args.slice(i);
}

for (const seg of segments) {
  const { word, args: words } = commandWord(seg);
  const args = word === 'git' ? gitSubcommand(words) : words;

  if (/\bpush-secrets\.sh\b/.test(seg)) {
    deny.push('Secrets are written by the user, not Claude. Ask them to run engine/deploy/push-secrets.sh themselves.');
  }

  if (word === 'git' && args[0] === 'push') {
    const force = args.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || /^\+/.test(a));
    // main is production and develop is where everyone's work comes together: both change by pull request.
    const shared = args.map((a) => a.match(/(?:^|:|\+)(?:refs\/heads\/)?(main|master|develop)$/)?.[1]).find(Boolean);
    if (force && shared) deny.push(`Force-pushing ${shared} is never allowed.`);
    else if (force) ask.push('Force-push rewrites history that teammates may have pulled.');
    else if (shared) ask.push(`Pushing straight to ${shared}: the team changes ${shared} through pull requests.`);
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
  // gh commands that reach main or production without a git push. Starting or re-running a workflow is
  // how the engine deploys (.github/workflows/engine-deploy.yml); a re-run deploys the commit it first ran on.
  if (word === 'gh') {
    const [cmd, sub] = args;
    if (cmd === 'workflow' && sub === 'run') {
      ask.push('This starts a GitHub Actions workflow; Engine deploy ships the engine to production.');
    }
    if (cmd === 'run' && sub === 'rerun') {
      ask.push('This re-runs a workflow run; an Engine deploy run redeploys the commit it ran on to production.');
    }
    if (cmd === 'pr' && sub === 'merge') {
      ask.push('Merging a pull request: into main it ships to production (Railway, Vercel); into develop it changes the shared branch.');
    }
    if (cmd === 'api') {
      // gh api sends a POST when given fields, unless a method is named.
      const named = args.find((a, i) => /^(-X|--method)$/.test(args[i - 1] ?? '')) ?? args.find((a) => a.startsWith('--method='))?.slice(9);
      const fields = args.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(raw-)?field=/.test(a));
      if ((named ? named.toUpperCase() !== 'GET' : fields) || args.some((a) => /\/(dispatches|merges|rerun)\b/.test(a))) {
        ask.push('This gh api call changes something on GitHub (a workflow dispatch deploys the engine to production).');
      }
    }
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
