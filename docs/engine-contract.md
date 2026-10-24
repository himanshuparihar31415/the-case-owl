# Interview engine ⇄ platform contract (v1)

How the interview engine (`engine/`, a separate Python service) connects to the Case Owl platform
(Node API on Railway, React app on Vercel; the engine on a Hostinger VPS at `https://srv2011824.hstgr.cloud`,
behind Caddy).
The engine is built and tested on its own first
(stage 1), then plugged in behind a switch (stage 2). This document is the boundary both sides
build against, so integration is wiring, not redesign.

Status: draft, 23 Oct 2026. Companion to the [architecture plan](interview-engine-architecture.md).

---

## Ground rules

1. **Node stays the system of record**: users, auth, credits, `Session` documents and reports. The
   engine never reads or writes wallets, plans, users, or any existing collection.
2. **The engine owns only the live interview**, from call start to call end. It has its own database
   and hands Node everything it needs at the end, in shapes Node already uses.
3. **Reports keep working unchanged.** The transcript arrives in today's `Session.transcript` shape
   (`role`, `text`, `timestamp`; hints prefixed `[HINT]`), so `report.service.ts` needs no change.
4. **The answer never reaches the browser.** The OpenAI key, the case's facts and its tree live only
   in the engine. No response to the page, from Node or the engine, carries them.
5. **Additive only.** Stage 2 adds routes and an opt-in path; no existing route, message or pipeline
   changes behaviour for sessions that are not on the engine.
6. **Scope of v1:** consulting cases (`module: 'case'`), profitability first. Product and
   guesstimate interviews stay on the current pipelines.

---

## The flow

```
Page                      Node API                         Engine                        OpenAI
 │ POST /api/sessions ──►  reserve credits, create Session (unchanged)
 │ getUserMedia, createOffer (no data channel)
 │ POST /api/voice/call ─► check owner, active, case v2,
 │   {sessionId, sdp}      user on pilot list
 │                         POST /v1/calls ───────────────► check offer, load case,
 │                           {session, case, limits, sdp}   POST /v1/realtime/calls ───► 201 + Location
 │                                                          open the control socket ───► (sideband)
 │ ◄── {sdpAnswer, ui} ─── ◄── 201 {callId, sdpAnswer, ui} ─┘
 │ setRemoteDescription                                                     audio ⇄ OpenAI (WebRTC)
 │ open UI socket ─────────────────────────────────────────► session_ready, transcripts, stage, hints…
 │ … interview …
 │ end_session (UI socket) ────────────────────────────────► ends the call, flushes the transcript
 │                         ◄── POST /internal/sessions/:id/settle {transcript, summary}
 │                         write transcript, status, duration; settle credits (existing, idempotent)
 │                         ──► 200 ──────────────────────────►
 │ ◄──────────────────────────────────────────────── session_ended {reason}
 │ PATCH /api/sessions/:id/end {scratchpad}   (saves the scratchpad; already settled)
 │ → /report/:id   (reads Session.transcript as today)
```

**Change from the plan:** the page talks to the engine's UI socket directly, with a token the engine
issues, instead of going through Node's `/api/voice` socket. A Node proxy would add a hop and make
every Node deploy drop live interviews' sockets; the plan's end state was a direct socket anyway.

---

## 1. Node → engine (service API)

Base URL `ENGINE_URL` (e.g. `https://engine.internal…`). Every request carries
`Authorization: Bearer <ENGINE_SERVICE_TOKEN>`. JSON bodies; errors are
`{"error": {"code": "...", "message": "..."}}`.

### `POST /v1/calls` — start a call

```json
{
  "sessionId": "6718…",
  "userId": "66f2…",
  "caseId": "66f9…",
  "sdpOffer": "v=0\r\n…",
  "limits": { "maxMinutes": 30 },
  "config": { "interviewerStyle": "neutral", "difficulty": 2, "candidateFirstName": "Paritosh" }
}
```

- `limits.maxMinutes` is the session's `reservedMinutes`. The engine closes the interview at that
  point, with a wrap-up line two minutes before.
- `config.candidateFirstName` is optional, for the greeting. Nothing else about the user is sent.

`201 Created`

```json
{
  "callId": "rtc_u7_…",
  "sdpAnswer": "v=0\r\n…",
  "ui": { "url": "wss://engine…/v1/calls/rtc_u7_…/ui", "token": "eyJ…", "expiresAt": "2026-10-23T11:05:00Z" }
}
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_offer` | Not a usable SDP offer |
| 400 | `data_channel_not_allowed` | The offer asks for a data channel (`m=application`); a page with one could rewrite the session |
| 409 | `case_not_ready` | No published fact tree for this case in the engine |
| 409 | `call_exists` | This session already has a live call (use re-offer) |
| 429 | `at_capacity` | Engine or OpenAI concurrency limit reached; Node shows "try again in a minute" |
| 502 | `upstream_unavailable` | OpenAI refused or timed out |
| 503 | `draining` | The engine is shutting down for a deploy; Node retries once |
| 400 | `invalid_request` | A malformed body; the message names the field |
| 401 | `unauthorized` | Missing or wrong service token |

Every route that names a call answers `404 call_not_found` for an ID the engine does not know, and
`503 call_moving` while the interview is being handed from one engine instance to the next (a
deploy or a restart, section 7). Node retries `call_moving` every second for up to 15 s.

Target: p95 under 2.5 s (the spike measured 1.0–1.6 s for the OpenAI exchange from India).

### `POST /v1/calls/{callId}/reoffer` — reconnect audio after a WebRTC drop

`{"sdpOffer": "…"}` → `200 {"sdpAnswer": "…"}`. Same interview state: the engine opens a new OpenAI
call and rebuilds the interviewer's context from the transcript and stage. `410 call_ended` if the
interview is over.

### `POST /v1/calls/{callId}/end` — end from outside the page

`{"reason": "candidate_ended" | "abandoned" | "admin"}` → `202`. Idempotent. Settlement follows
through the settle callback, as for any other ending.

### `POST /v1/calls/{callId}/hint` — the Hint button (phase 3; until then `501 not_implemented`, or `410 call_ended`)

Node forwards `GET /api/sessions/:id/hint` here for engine sessions, so hints go through the
engine's budget and spacing rules. `200 {"hint": "…" | null, "level": 1, "used": 1, "max": 3,
"declined": null | "budget_spent" | "too_soon"}`. The engine also tells the interviewer a hint is on
screen, and records it in the transcript as `[HINT] …`.

### `GET /v1/calls/{callId}` — status, for support and admin

`200 {"state": "live", "stage": "case", "startedAt": "…", "elapsedSeconds": 412}`.

### `GET /healthz`, `GET /readyz`

`/healthz` is liveness, `{"ok": true, "version": "<commit>"}`. `/readyz` answers `{"ok": true,
"live": <interviews>}`, and `503` while the instance shuts down, so no new calls are routed to it.

---

## 2. Engine → Node (settle callback)

### `POST {NODE_URL}/internal/sessions/{sessionId}/settle`

`Authorization: Bearer <NODE_INTERNAL_TOKEN>`. Sent once the interview ends, for any reason, after
the transcript has been saved in the engine's own database.

```json
{
  "callId": "rtc_u7_…",
  "endedReason": "candidate_ended",
  "startedAt": "2026-10-23T10:35:02Z",
  "endedAt": "2026-10-23T11:02:40Z",
  "durationSeconds": 1658,
  "transcript": [
    { "role": "interviewer", "text": "Hi, I'm Maya…", "timestamp": "2026-10-23T10:35:04Z" },
    { "role": "candidate", "text": "I'm good, thanks…", "timestamp": "2026-10-23T10:35:11Z" },
    { "role": "interviewer", "text": "[HINT] Think about what changed inside costs.", "timestamp": "…" }
  ],
  "summary": {
    "stageReached": "case",
    "factsReleased": ["cost_total", "cost_split", "variable_detail", "beans"],
    "hintsUsed": 1,
    "guardHits": 0,
    "costUsd": 2.04
  }
}
```

- `endedReason`: `candidate_ended` · `time_cap` · `candidate_disconnected` (no re-offer within 60 s)
  · `abandoned` · `admin` · `engine_error` · `upstream_error`.
- **Transcript:** only what the candidate heard. Interviewer turns are cut to the heard part, and
  replies nobody heard are left out. Ordered by conversation, not arrival.
- `durationSeconds` is the time the audio was live. It is what credits are charged on, capped at
  `reservedMinutes`, as `settleSession` already does.

Node's handler:
1. Write `transcript`, `status` (`completed`, or `abandoned` for `candidate_disconnected` and
   `abandoned`), `endedAt` and `durationSeconds` on the `Session`.
2. Store `summary` and `callId` under a new optional `Session.engine` field.
3. Call the existing `settleSession(sessionId)`.
4. Reply `200 {"ok": true}`.

The handler must be idempotent: a repeat call with the same `callId` returns 200 and changes nothing.
The engine retries on any non-2xx response, with backoff (1 s, 5 s, 30 s, then every 5 minutes for 24 h),
and alerts after the third failure. The transcript is safe in the engine meanwhile. A delivery cut
short by a deploy is resumed by the next instance, within the same 24 hours; so Node can receive a
repeat, which the idempotent handler absorbs.

Until stage 2 the engine runs with `NODE_URL` unset: it settles nowhere (`settle.status: "skipped"`),
and each transcript stays in `engine_sessions`.

The page's `PATCH /api/sessions/:id/end {scratchpad}` still runs after `session_ended`. For engine
sessions Node saves the scratchpad even if the status is already `completed`; today it returns 400.

---

## 3. Page ⇄ engine (UI socket)

`wss://…/v1/calls/{callId}/ui?token=<ui.token>`. The engine checks the token and the `Origin`
(the app's domains). The same token works for reconnects until it expires (the interview's time
cap plus 5 minutes). Close codes: `4001` bad or expired token, or an origin not allowed; `4004` call
ended (do not reconnect); `1012` the engine is restarting and `1013` the interview is moving to the
next instance (both: reconnect with backoff, from 0.5 s, for about 30 s). The engine keeps the token
out of its logs, and its proxy (Caddy) keeps no access log. The token is short-lived and good for one
call only all the same.

The interview starts (her greeting, and the clock) when the page sends `audio_live`. A call whose
page never does within 60 s ends as `candidate_disconnected`.

Messages the page already handles keep their names and shapes, so `Session.tsx` changes little.

**Engine → page**

| Message | Payload | Notes |
|---|---|---|
| `session_ready` | `{}` | As today. Once the interview has started it is followed by a `snapshot` (after a reconnect, or a page that joins late) |
| `snapshot` | `{transcript: [...], stage, remainingSeconds}` | New. Full state after a reconnect |
| `transcript_delta` | `{role, text, itemId}` | As today, plus `itemId`, so each bubble has an id |
| `transcript` | `{role, text, itemId}` | As today, plus `itemId` |
| `retract` | `{itemIds: [...]}` | New. Remove these bubbles: replies cancelled before anyone heard them |
| `exhibit` | `{exhibit}` | As today (exhibit cases, later) |
| `stage` | `{stage}` | New. `intro`, `case`, `wrap_up` |
| `think_timer` | `{state: "started" \| "ended", seconds}` | New. "Taking a minute" indicator |
| `hint` | `{text, level, used, max}` | New. Shown on screen |
| `time` | `{remainingSeconds}` | New. At 5 and 2 minutes left |
| `notice` | `{code, message}` | New. Non-fatal (e.g. `use_headphones`); must not put the page in its error state |
| `reoffer_required` | `{}` | New. Audio dropped; the page creates a new offer and calls re-offer |
| `session_ended` | `{reason}` | As today, plus `reason`. Sent after Node has acknowledged the settle, or after 8 s, so a slow Node never holds the page; the retries carry on |
| `error` | `{code, message, fatal}` | As today, plus `code` and `fatal` |

**Page → engine**

| Message | Payload | Notes |
|---|---|---|
| `audio_live` | `{}` | As today: WebRTC is connected |
| `end_session` | `{}` | As today |
| `activity` | `{source: "scratchpad"}` | New. Typing in the scratchpad holds off nudges |
| `ping` | `{}` | Keep-alive every 20 s |

Not used on the engine path: `audio_chunk` and `speech_started`, since audio goes over WebRTC.

---

## 4. Page ⇄ Node (stage 2 additions)

The existing JWT applies. Nothing changes for sessions not on the engine.

| Route | Purpose |
|---|---|
| `POST /api/voice/call` `{sessionId, sdpOffer}` | Checks the session belongs to the user and is active, and that the case and user are on the engine. Forwards to `POST /v1/calls`, stores the `callId`, returns `{sdpAnswer, ui}`. `409 not_engine_session` tells the page to use today's socket |
| `POST /api/voice/call/:sessionId/reoffer` `{sdpOffer}` | Forwards to re-offer |
| `GET /api/sessions/:id/hint` | Unchanged for other sessions; forwarded to the engine for engine sessions (phase 3) |
| `POST /internal/sessions/:id/settle` | The settle callback above. Service token only; not reachable with a user JWT |

**Routing switch:** a session uses the engine only when `Case.engine === 'v2'` **and** the user is in
`Setting.enginePilotUserIds`, editable through `PATCH /api/admin/settings` without a redeploy.
Removing either one sends new sessions back to today's pipeline.

---

## 5. Data

**Engine database** (same Atlas cluster, its own database `engine`, credentials limited to it):

| Collection | Contents |
|---|---|
| `engine_cases` | `caseId` (the platform `Case._id`), `version`, `status` (`draft` \| `published`), `statement`, `facts[]` (`id`, `parent`, `covers`, `answer`, `terms`, `requires`), `leads[]`, `tree` and `hints` (phase 3), `validatorReport`. The shape of `engine/spike/cases/coffee.json`. Only `published` versions run |
| `engine_sessions` | `sessionId`, `callId`, `userId`, `caseId`, `caseVersion`, `state`, `stage`, `startedAt`, `endedAt`, `endedReason`, `released[]`, `hintsUsed`, `transcript[]`, `settle` (`status`, `attempts`, `lastError`). Enough to rebuild a live interview after a restart |
| `session_events` | `sessionId`, `t`, `type`, `payload`: the decision log (turns, tool calls, facts, guard, latency, tokens). TTL 90 days |

**Platform changes** (stage 2, all optional fields, so no migration):

| Model | Field |
|---|---|
| `Case` | `engine?: 'v2'` |
| `Session` | `engine?: { callId, endedReason, summary }` |
| `Setting` | `enginePilotUserIds: ObjectId[]` (default empty) |

The case's `referenceTree` for reports is still `Case.referenceTree`. In phase 2, case generation
writes it there and the fact tree to `engine_cases` together, so the interview and the report grade
against the same tree.

---

## 6. Secrets and security

| Secret | Held by | Used for |
|---|---|---|
| `OPENAI_API_KEY` | Engine only | OpenAI calls. Never in a response |
| `ENGINE_SERVICE_TOKEN` | Node and engine | Node → engine requests |
| `NODE_INTERNAL_TOKEN` | Node and engine | Engine → Node settle callback |
| `ENGINE_UI_SECRET` | Engine only | Signs UI tokens (`callId`, `sessionId`, `userId`, `exp`) |
| `MONGO_URI` | Engine only | The `engine` database (on the platform's Atlas cluster, its own database) |

- Offers with a data channel are refused, so the browser cannot change the session.
- The answer-key leak in today's session and case APIs is fixed on the platform before any pilot.
- Transcripts are personal data. They stay in the two databases, logs carry ids rather than
  text, and `session_events` expires after 90 days.

---

## 7. Lifecycle and failures

States: `connecting` → `live` (stages `intro` → `case` → `wrap_up`) → `ending` → `ended`
(transcript saved) → `settled` (Node acknowledged).

| Event | Behaviour |
|---|---|
| Time cap | `time` at 5 and 2 minutes left, a wrap-up line, then `ended` with `time_cap` |
| WebRTC drops | `reoffer_required` to the page. No re-offer within 60 s ends the call with `candidate_disconnected` |
| UI socket drops | The interview continues; the page reconnects with the same token and gets a `snapshot` |
| Engine deploy or restart | Hand-off, not drain. The audio runs browser ⇄ OpenAI, never through the engine, so on SIGTERM the engine stops taking calls (`/readyz` 503), gives interviews already ending up to 5 s, then releases every interview it holds: it closes only its control socket, leaves the OpenAI call up, and saves the interview with no lease. The next instance claims each one at startup, reattaches to the same OpenAI call and carries on. Interviews owed a settle are resumed the same way. The candidate hears at most a pause, the length of the restart (a few seconds: Docker Compose stops the old container before starting the new one, and Caddy holds requests meanwhile), and the page reconnects (`1012`). Verified live on 23 Oct: two restarts in one call, the third process spoke on the original call and settled it |
| Engine crash | Each instance renews a 30 s lease on its interviews every 10 s. Another instance takes one over only once its lease was released (hand-off) or has lapsed (crash), through an atomic claim, so two instances never steer one call. The new owner reattaches to the same OpenAI call, or asks the page to re-offer if it is gone; no re-offer within 60 s ends the call and settles it. A page or Node request that arrives mid-hand-off gets `1013` or `503 call_moving` and retries. Run one replica: a page's socket must land on the instance that owns its interview |
| OpenAI error | One reconnect; otherwise apologise, end with `upstream_error`, settle the time used |
| Node unreachable at settle | Retries for 24 h (section 2); the transcript is safe in `engine_sessions` |

---

## 8. Versioning and tests

- Paths carry the version (`/v1`). Within v1, changes are additive: new optional fields or new
  messages. Each side ignores what it doesn't know. A breaking change means `/v2`, with both
  served during the switch.
- Each request, response and socket message gets a JSON Schema under `engine/contract/`. The
  engine's tests validate what it sends. A Node test validates the settle payload and the
  `/api/voice/call` response against the same files.
- Stage 1 includes a stub of Node (a few lines: accept the settle callback, record it) so the
  engine's end-to-end tests cover the whole flow without the platform.

---

## 9. What exists when

| Piece | Stage 1 (engine alone) | Stage 2 (integration) |
|---|---|---|
| Service API (`/v1/calls`, re-offer, end, status, health) | Built; the engine's test page and the Node stub call it | Node calls it |
| UI socket | Built; used by the engine's test page | Used by `Session.tsx` |
| Settle callback | Sent to the Node stub | Node's `/internal/sessions/:id/settle` |
| Hint route | Built (phase 3) | Node forwards the Hint button |
| `engine_cases` | Published from `engine/cases/*.json` at startup (a changed file becomes a new version; a version made any other way is never overwritten), then by case generation (phase 2) | Same |
| Platform fields and routing switch | — | Added |

## Open questions

1. **Exhibits.** Some consulting cases reveal exhibits. In v1 the engine could release them through
   the same gate as facts (an exhibit counts as a fact with a visual). Confirm before phase 2.
2. **Interviewer style** (`supportive` / `neutral` / `stress`). Map to instruction variants, or
   start the pilot with `neutral` only.
3. **Voice choice.** Engine sessions use OpenAI voices. The pilot uses a fixed voice, and the
   ElevenLabs picker is hidden for those sessions.
