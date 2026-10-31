export const meta = {
  name: 'review-changes',
  description: 'Review the current changes from every angle that applies, in parallel, then have two skeptics try to refute each finding',
  whenToUse: 'Before shipping a large or risky change (engine, contract, billing, auth, voice). Heavier and more thorough than /review-diff.',
  phases: [
    { title: 'Scope', detail: 'what changed, and which review angles apply' },
    { title: 'Review', detail: 'one reviewer per angle' },
    { title: 'Verify', detail: 'two skeptics per finding' },
  ],
}

// args: optional string naming the target (a branch, a commit range, files). Default: uncommitted work.
const TARGET = typeof args === 'string' && args.trim()
  ? args.trim()
  : 'the uncommitted changes (git diff HEAD plus untracked files)'
const MAX_VERIFIED_PER_ANGLE = 8

const SCOPE = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    angles: { type: 'array', items: { type: 'string', enum: ['correctness', 'security', 'contract', 'behaviour'] } },
  },
  required: ['files', 'angles'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          summary: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'summary', 'scenario'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const ANGLES = {
  correctness: {
    agentType: 'code-reviewer',
    prompt: 'Review for correctness bugs and breaks of the project rules, as your instructions describe.',
  },
  security: {
    agentType: 'security-reviewer',
    prompt: 'Review for security problems, as your instructions describe. The answer key reaching the browser comes first.',
  },
  contract: {
    agentType: 'contract-keeper',
    prompt: 'Check that the engine, the platform and the page agree on every shape this change touches, and that docs/engine-contract.md matches. Report each mismatch as a finding.',
  },
  behaviour: {
    agentType: 'general-purpose',
    prompt: 'Review the change to the AI interviewer against .claude/rules/interviewer-behaviour.md: does any prompt or code make her coach, hint, propose an approach, answer her own question, ask permission repeatedly, or replace model judgment with counters and phrase bans? Does any engine change let history differ from what the candidate heard? Is there an eval scenario that proves the change? Read-only.',
  },
}
const RANK = { critical: 0, high: 1, medium: 2, low: 3 }

phase('Scope')
const scope = await agent(
  `In this repo, list what changed in ${TARGET}. Use read-only git commands. Return the changed files and the review angles that apply:
- "correctness": always.
- "security": any change in server/ routes, controllers, services, models or middleware, server.ts, server/modules/voice/, server/modules/billing/, engine/app/ api, ui, auth or config, vite.config.ts, .env.example, or upload handling.
- "contract": any change in engine/app/contract.py, engine/contract/, docs/engine-contract.md, server/modules/engine/ or src/hooks/useEngineInterview.ts.
- "behaviour": any change in engine/app/runtime/, engine/cases/, engine/tools/evals.py, server/ai/ or server/modules/voice/.`,
  { label: 'scope', schema: SCOPE, effort: 'low' },
)

if (!scope || !scope.files.length) return { confirmed: [], disputed: [], note: `Nothing changed in ${TARGET}.` }

const angles = ['correctness', ...scope.angles.filter((a) => a !== 'correctness' && ANGLES[a])]
log(`${scope.files.length} changed files; reviewing for ${angles.join(', ')}`)

const unverified = []
const results = await pipeline(
  angles,
  (angle) => agent(
    `${ANGLES[angle].prompt}\n\nTarget: ${TARGET}.\nChanged files:\n${scope.files.join('\n')}\n\nReturn only findings you traced in the code. An empty list is a fine answer.`,
    { label: `review:${angle}`, phase: 'Review', agentType: ANGLES[angle].agentType, schema: FINDINGS },
  ),
  (review, angle) => {
    const sorted = (review?.findings ?? []).slice().sort((a, b) => RANK[a.severity] - RANK[b.severity])
    const checked = sorted.slice(0, MAX_VERIFIED_PER_ANGLE)
    if (sorted.length > checked.length) {
      unverified.push(...sorted.slice(checked.length).map((f) => ({ ...f, angle })))
      log(`${angle}: ${sorted.length - checked.length} lower-severity findings left unverified`)
    }
    return parallel(checked.map((f) => () =>
      parallel([0, 1].map((i) => () => agent(
        `A reviewer reported this problem in the repo's current changes (${TARGET}). Try to refute it by reading the code: is it guarded elsewhere, impossible given the types or data, or not actually reachable? Default to refuted=true if you cannot trace a concrete input or state that produces the wrong result.\n\n${JSON.stringify(f, null, 2)}`,
        { label: `verify:${angle}:${f.file}${f.line ? `:${f.line}` : ''}#${i + 1}`, phase: 'Verify', schema: VERDICT },
      ))).then((votes) => {
        const cast = votes.filter(Boolean)
        return { ...f, angle, upheld: cast.filter((v) => !v.refuted).length, of: cast.length, notes: cast.map((v) => v.reason) }
      }),
    ))
  },
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => f.of > 0 && f.upheld === f.of)
const disputed = all.filter((f) => f.upheld > 0 && f.upheld < f.of)
const refuted = all.filter((f) => f.upheld === 0)
log(`${confirmed.length} confirmed, ${disputed.length} disputed, ${refuted.length} refuted, ${unverified.length} unverified`)

return { target: TARGET, angles, confirmed, disputed, unverified, refutedCount: refuted.length }
