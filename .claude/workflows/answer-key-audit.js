export const meta = {
  name: 'answer-key-audit',
  description: 'Find every path from case data to the browser and check that none can reveal the answer during a live interview',
  whenToUse: 'Before widening the pilot or launching, and after changes to cases, sessions, reports, the voice socket or the engine routes.',
  phases: [
    { title: 'Map', detail: 'every place case data can reach the browser' },
    { title: 'Audit', detail: 'one security reviewer per site' },
    { title: 'Verify', detail: 'a skeptic re-checks each exposure' },
  ],
}

const SITES = {
  type: 'object',
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          where: { type: 'string' },
          touches: { type: 'string' },
        },
        required: ['file', 'where', 'touches'],
      },
    },
  },
  required: ['sites'],
}
const AUDIT = {
  type: 'object',
  properties: {
    exposed: { type: 'boolean' },
    fields: { type: 'array', items: { type: 'string' } },
    path: { type: 'string' },
    fix: { type: 'string' },
  },
  required: ['exposed', 'path'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const ANSWER = 'answerKey, plausibleSolution, privateMechanismNote, forbiddenTerms, referenceTree, quant.answer, exhibits not yet earned, and in the engine any fact not yet released through lookup_fact'

phase('Map')
const map = await agent(
  `Find every place in this repo where case data can reach the browser. Case data means a Case document (server/models/Case.ts, including through populate on Session or Report) or an engine case (engine/cases/*.json, the engine_cases collection). Look at: HTTP handlers under server/modules/**, WebSocket messages in server/modules/voice/** and server.ts, the engine's HTTP responses and UI-socket messages in engine/app/**, and the interviewer's instructions and spoken output paths in engine/app/runtime/**. List each place as a site: the file, the route or function, and which case data it touches. Read-only. Be exhaustive; a missed site is the failure that matters.`,
  { label: 'map', schema: SITES },
)

const sites = map?.sites ?? []
if (!sites.length) return { exposed: [], note: 'The map found no sites; re-run, this is unlikely to be true.' }
log(`${sites.length} sites to audit`)

const results = await pipeline(
  sites,
  (site) => agent(
    `Audit one site for answer-key exposure.\n\nSite: ${JSON.stringify(site)}\n\nThe answer is: ${ANSWER}. The ANSWER_FIELDS projection in server/models/Case.ts strips most of these. The report page may show them, but only after the session has ended.\n\nQuestion: can a candidate, while their session is live, receive any of the answer through this site? Trace the exact path from the read to what is sent, including populate() calls and projections. Set exposed=true only if you can name the request or message that carries it.`,
    { label: `audit:${site.file}`, phase: 'Audit', agentType: 'security-reviewer', schema: AUDIT },
  ),
  (audit, site) => {
    if (!audit?.exposed) return { site, ...audit, status: 'clean' }
    return agent(
      `A reviewer claims this site leaks the case answer to a candidate during a live interview. Try to refute it by reading the code: a projection, a status check, a field that is never set, a route the live page never calls. Default to refuted=true only if you find the guard.\n\nSite: ${JSON.stringify(site)}\nClaim: ${JSON.stringify(audit)}`,
      { label: `verify:${site.file}`, phase: 'Verify', schema: VERDICT },
    ).then((v) => ({ site, ...audit, status: v?.refuted ? 'refuted' : 'exposed', verifier: v?.reason }))
  },
)

const done = results.filter(Boolean)
const exposed = done.filter((r) => r.status === 'exposed')
const lost = sites.length - done.length
if (lost) log(`${lost} sites returned no result and were not audited`)
log(`${exposed.length} exposed, ${done.filter((r) => r.status === 'refuted').length} claims refuted, ${done.filter((r) => r.status === 'clean').length} clean`)

return { exposed, refuted: done.filter((r) => r.status === 'refuted'), clean: done.filter((r) => r.status === 'clean').map((r) => `${r.site.file}: ${r.site.where}`), notAudited: lost }
