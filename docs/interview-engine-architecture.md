# Interview Engine — Architecture Proposal

**Revised:** 2026-10-19 after a validation pass · **Shared, editable version (with drawn diagrams):** https://claude.ai/artifact/LnVxkRPn9z5LpZxXCyz91i

Build the interview as a separate Python service: audio over WebRTC straight to OpenAI, one voice agent, a deterministic engine that owns turn-taking and decisions, and no multi-agent system at runtime. Existing interviews keep running on today's pipelines while the engine is piloted. Latency and cost figures are targets to validate, not measurements.

---

## What changed in this revision

A validation pass on 19 Oct (my own checks plus an independent review, each finding verified against the code or OpenAI's docs) found 17 problems; every fix is folded into the sections below. The biggest change: audio now goes over WebRTC straight to OpenAI, and the engine steers from the side.

| # | Problem found | Fix |
|---|---|---|
| 1 | The live interview page receives the answer key: `GET /sessions/:id` populates the whole case (`session.service.ts:86`), as do the `/cases` endpoints | Project answer-key fields out of every response while a session is active. Fix now, independent of the engine |
| 2 | Audio relayed over a WebSocket and played through Web Audio escapes browser echo cancellation; past builds fought false barge-ins and fell back to assuming headphones (commits `6e45e08`, `97840a0`, `264d289`) | Audio over WebRTC directly between the browser and OpenAI; the engine controls the session over OpenAI's sideband connection |
| 3 | Server auto-reply and auto-interrupt act before the engine can: a cough cuts the interviewer off, and thinking aloud gets answered | The engine is the only turn authority; barge-in needs 450 ms of sustained speech; listening mode for thinking time |
| 4 | Rewriting the instructions every turn breaks prompt caching, and `gpt-realtime-2` charges $32 per million uncached audio input tokens against $0.40 cached | The steering note becomes a conversation item; instructions never change mid-session |
| 5 | Ignoring every sound under 400 ms would also ignore a short "yes" | Short utterances wait for the transcript instead of being dropped |
| 6 | Every plan caps an interview at 30 minutes (`plans.service.ts`), not 45 | Stage budget derived from the reserved minutes |
| 7 | "No frontend change" was wrong: no reconnect, errors disable the controls, one live-transcript buffer for both roles | A contained frontend change, listed under Frontend contract |
| 8 | The Hint button bypasses the engine, and the report would count no hints | Hint requests go through the engine, which writes `[HINT]` transcript entries the report already counts |
| 9 | The report would grade against a different tree: Node builds its own `referenceTree` when one is missing | One canonical tree, written to `Case.referenceTree` at generation |
| 10 | Truncating at bytes sent leaves words the candidate never heard in the model's context | WebRTC truncates at what was actually played; a fact counts as disclosed only if heard |
| 11 | Invented numbers pass the leak monitor | The monitor also flags any number outside the given and disclosed facts |
| 12 | Async writes can miss the closing turns before the report runs | Flush the transcript before acknowledging `end_session`; order entries by conversation item |
| 13 | The plan said keep reasoning effort low, but this repo moved to high because low gave shallow follow-ups (`68dbef8`) | Start at high; measure low, medium and high in phase 0 |
| 14 | Silence-window figures disagreed between sections, and felt latency was never targeted | One set of figures; targets for both model latency and felt latency |
| 15 | Worry that a long session overflows the context | `gpt-realtime-2` has a 128,000-token window; a 30-minute session uses about 18,000 audio tokens. Not a v1 risk |
| 16 | The voice picker lists ElevenLabs voices | OpenAI voices for engine cases (decided) |
| 17 | `idle_timeout_ms` would fire server-side nudges, and `POST /internal/sessions/:id/settle` does not exist yet | Leave `idle_timeout_ms` unset; the settle endpoint is listed as new work |

---

## Decisions at a glance

Ten decisions define the design. The biggest change after validation is the audio path: WebRTC straight to OpenAI, with the engine steering from the side.

| Question | Decision |
|---|---|
| Separate service? | Yes — a Python interview engine. Node keeps auth, sessions, billing and reports. |
| Audio path | WebRTC straight between the browser and OpenAI. The engine never carries audio; it controls the session over OpenAI's sideband connection. |
| Frontend changes? | A contained change: the audio layer of `Session.tsx` moves to WebRTC, plus reconnect and a few UI fixes. The rest of the app is untouched. |
| Who talks? | One voice agent: `gpt-realtime-2` with its built-in voices. No ElevenLabs, which would add a text-to-speech hop to every reply. |
| Who decides? | A deterministic engine (state machine, timers, hint ladder, fact gate), not an LLM agent. |
| Turn-taking | The engine is the only turn authority. OpenAI's voice activity detection only reports speech; the engine fires, holds or cancels each reply from event timing, with no LLM wait. |
| Multi-agent? | No, not at runtime. Two narrow, stateless LLM functions sit off the critical path. Offline case generation is a generate → validate → repair workflow. |
| Latency rule | No LLM call on the critical path of an ordinary turn; the engine adds one engine-to-OpenAI round trip. |
| Accuracy rule | Policy at the tool boundary: the voice model never holds withheld facts or the answer key. Earned facts and hints come only through tools the engine gates. |
| Migration | Per case and per user: a session goes to the engine only when the case is flagged `engine: 'v2'` and the user is on the pilot list. |

**Judgment over rules.** The interviewer decides the flow of the conversation, as a person would: when small talk is done, how to handle a chatty or off-topic moment, when the candidate wants time. She acts through tools (`start_case`, `wait_for_candidate`), and the engine carries out the result. The engine keeps hard rules only for what must not be left to judgment: answers and unasked facts, turns nobody heard, timing (the model has no clock), the hint budget, the interview's time limit, and security.

**Security fix needed now, before any pilot:** `GET /api/sessions/:id` (which the live interview page calls), `GET /api/cases/:id` and `GET /api/cases` return the whole case with no field projection. That includes `plausibleSolution`, `answerKey`, `privateMechanismNote`, `forbiddenTerms`, `referenceTree`, `quant.answer` and the exhibits meant to be earned, so a candidate can read the answer during the interview. Verified in the code ([session.service.ts:86](../server/modules/sessions/session.service.ts), [case.controller.ts:75](../server/modules/cases/case.controller.ts)), not against a running server.

---

## Goals and targets

Three goals, in this order: low latency, accuracy and human-like behaviour, with cost as the constraint around them. The numbers are targets to validate, not measurements.

| Goal | Target |
|---|---|
| Model latency | End of speech to first audio at the browser: p50 ≤ 0.8 s, p95 ≤ 1.5 s, measured from India through the production path |
| Felt latency, conversation | Silence window plus model latency: about 1.4–2.1 s at p50 |
| Felt latency, listening mode | About 3.5–4 s, on purpose: a human interviewer also pauses after a framework |
| LLM work on the critical path | None for an ordinary turn |
| Accuracy: leaks | Zero answer-key leaks in adversarial tests, and no answer-key fields in any API response during a session |
| Accuracy: policy | Hint level, budget and spacing followed in every simulated run |
| Accuracy: tracking | Tree-coverage tracking agrees with a human or LLM-judge label; threshold set after a baseline |
| Human-like | Never talks over the candidate, a cough never stops it, waits while they think, stops within about half a second of a real interruption, honest about being an AI if sincerely asked |
| Cost | Cached input is the norm; a per-session budget is set after phase 0, against about ₹300 of Starter revenue per 30-minute interview |

---

## Architecture and components

Audio travels directly between the browser and OpenAI; the engine sits on a side channel, so it never adds delay to the sound itself.

```
 ┌───────────────────────────┐   audio, direct over WebRTC   ┌──────────────────────┐
 │ Browser: your React app   │◄─────────────────────────────►│ OpenAI Realtime      │
 │ mic + speaker over WebRTC │                               │ gpt-realtime-2       │
 │ plus a UI socket          │                               └──────────▲───────────┘
 └─────────────▲─────────────┘                                          │
               │ REST and UI socket                                     │ sideband control
 ┌─────────────┴─────────────┐                                          │ (call_id)
 │ Node API (existing)       │                                          │
 │ auth, billing, reports,   │                                          │
 │ routing                   │                                          │
 └─────────────▲─────────────┘                                          │
               │ SDP offer, hints, UI socket                            │
 ┌─────────────┴────────────────────────────────────────────────────────┴───────┐
 │ Interview Engine (Python), new service                                       │
 │   Gateway ◄──► Case Master ◄──► Sideband link                                │
 │                    ▲                                                         │
 │                    ▼                                                         │
 │               Turn Analyzer ──► OpenAI text model (structured calls)         │
 └─────────────┬────────────────────────────────────────────────────────────────┘
               ▼ load, then async writes
        MongoDB (shared with Node: sessions, cases, events)
```

Node stays in charge of accounts, billing and reports and only forwards control traffic. A Node deploy drops the UI socket, which reconnects; the audio keeps flowing.

| Component | Responsibility | On the reply path? |
|---|---|---|
| **Gateway** | Verify the JWT (shared secret), load the Session and Case, run the SDP exchange with OpenAI using the server-side key, enforce the time cap. | No |
| **Sideband link** | One WebSocket per interview to `wss://api.openai.com/v1/realtime?call_id=…`. Receives every session event; sends replies, cancels, notes and tool results. | Control only |
| **Case Master** | Per-session actor that owns turn-taking and holds state: stage, tree coverage, timers, hint ledger, disclosed facts. A pure reducer: (state, command) → (state, effects). | Decides when replies fire |
| **Turn Analyzer** | Small, fast LLM function: classifies the candidate's last utterance and maps it to tree nodes. Schema-bound, 1.5 s timeout, runs async. | Only in listening mode |
| **Fact resolver** | Maps a free-text question to a fact: precomputed embeddings first, a small LLM fallback only when ambiguous. | Only on tool turns |
| **Tool handlers** | `lookup_fact`, `request_hint`, `show_exhibit`, `check_quant`, `end_case`, all gated by policy. | Only on tool turns |
| **UI socket handler** | Sends transcripts, exhibits, stage and notices to the page; receives `audio_live`, `end_session` and activity. | No |
| **Generation service** | Offline case and tree generation with validators. | No |
| **Persistence** | Transcript in the existing shape, ordered by conversation item; decision log (`session_events`); a state snapshot per turn. Flushed before `end_session` is acknowledged. | No |

---

## Frontend contract

The page keeps the app's message protocol for everything except audio. Audio moves to WebRTC, which is the one real frontend change.

### Connection flow

1. The interview page opens the existing UI socket (`/api/voice?token&sessionId`) and creates a WebRTC offer from the mic.
2. It sends the offer to `POST /api/voice/call` (new). Node checks the pilot flags and forwards it to the engine.
3. The engine posts the offer and the session config to OpenAI's `/v1/realtime/calls` with the server-side key, reads the call ID from the `Location` header, and opens the sideband socket with it. No key ever reaches the browser, and the engine refuses any offer that asks for a data channel.
4. The page applies the answer, and audio flows directly between the browser and OpenAI.
5. The UI socket carries everything else: transcripts, exhibits, stage, notices and hint events.

### UI socket messages

Kept as they are: `session_ready`, `transcript_delta`, `transcript`, `exhibit`, `session_ended` and `error` (engine to page), and `audio_live` and `end_session` (page to engine). `audio_chunk` and `speech_started` leave this path, because audio no longer travels over the socket.

| New message | Direction | Purpose |
|---|---|---|
| `notice` | Engine to page | A non-fatal on-screen message (for example "use headphones") that doesn't put the page into its error state |
| `stage` | Engine to page | `{stage, label}` for an optional progress UI |
| `think_timer` | Engine to page | `{state, seconds}` for a "taking a minute" indicator |
| `hint_used` | Engine to page | `{level, count, max}` |
| `activity` | Page to engine | `{type: 'scratchpad'}`: typing suppresses nudges |

### Frontend work

| Change | Why |
|---|---|
| The audio layer of `Session.tsx` moves to WebRTC; the demo's working code ([scripts/realtime-voice-demo.html](../scripts/realtime-voice-demo.html)) is the starting point | Browser echo cancellation works on WebRTC playback but not on today's Web Audio playback (commits `6e45e08`, `97840a0`) |
| Reconnect the UI socket and re-offer WebRTC after a drop | Today `onclose` only shows an error ([Session.tsx:377](../src/pages/Session.tsx)) |
| One live-transcript buffer per role | Today both roles share one buffer and any final transcript clears it ([Session.tsx:351](../src/pages/Session.tsx)) |
| Handle `notice` without entering the error state | Today `error` disables the controls |
| The voice picker lists OpenAI voices for engine cases | Today it lists ElevenLabs voices ([Config.tsx:288](../src/pages/Config.tsx)) |
| A short echo check before the interview | Catches users without headphones before the case starts |

### REST and routing

- For engine sessions, Node forwards `POST /api/voice/call` (new) and the Hint button's existing `GET /sessions/:id/hint` to the engine, so hints go through the engine's gate.
- The engine calls a new Node endpoint, `POST /internal/sessions/:id/settle` (shared secret), at session end. Settlement is already idempotent.
- Pilot gating: a session goes to the engine only when the case is flagged `engine: 'v2'` and the user is on a pilot list kept in the existing global `Setting` document, editable through `PATCH /api/admin/settings` without a redeploy.
- End state: once v2 is stable, point `VITE_API_URL` at the engine for the UI socket and drop the Node hop.

---

## A turn, step by step

An ordinary turn needs no LLM call: the candidate waits only for the silence window, the engine's reply trigger and the model.

```
 What the candidate waits for                 speech_stopped
 [Candidate speaks] ──► [Silence window] ─────────┼──► [Engine fires reply] ──► [Reply plays, direct over WebRTC]
                        (the largest wait)        ┊
 Runs beside it, off the critical path            ┊
                                                  └──► [Turn Analyzer, ≤ 800 ms] ──► [Engine updates tree, stage,
                                                                                      timers; note for next turn]
```

At end of speech the engine fires the reply from a fixed rule, with no transcript or LLM wait, which costs one engine-to-OpenAI round trip. The analyzer's note steers the next turn, never this one. Listening mode (next section) waits longer on purpose.

### Latency budget

| Segment | Size | On the critical path? | Notes |
|---|---|---|---|
| Silence window | 600–2,000 ms by stage | Yes, the biggest | Stage-aware; see Conversation stages |
| End-of-speech event to the engine, reply trigger back | One engine-to-OpenAI round trip | Yes | Host the engine next to OpenAI's Realtime endpoint |
| Model time to first audio | Measure in phase 0 | Yes | Reasoning effort starts at high; measure low, medium and high. Simple engine-issued lines (greeting, acknowledgements, check-ins) run at minimal reasoning per reply |
| Audio to the browser | WebRTC from OpenAI's edge | Yes | No relay hops, no base64 JSON |
| Short-utterance hold | A transcript wait of a few hundred ms | Only for utterances under about 300 ms | |
| Listening-mode hand-back | Transcript plus analyzer, about 1–1.5 s | Only in listening mode | A human interviewer pauses here too |
| Turn Analyzer, conversation mode | ≤ 800 ms | No | Runs beside the reply |
| Tool round trip | An embedding lookup plus a second model pass | Tool turns only | Given facts live in the instructions, so most clarifying questions skip it |
| Database writes | Any | No | Async, flushed at session end |

### Rules that keep the engine out of the way

- No LLM call, transcript wait or database await before an ordinary reply: the trigger decides from event timing alone.
- Audio never touches the engine or Node.
- Open the sideband and send the session config while the page is still loading the case.
- `uvloop`, `orjson` and bounded queues in the engine; under backlog, drop analyzer work, never a reply trigger.
- Measure through the real production path from India, not the demo's direct connection, and report felt latency (silence window plus model time) for each stage.

**Later optimisation: speculative analysis.** Start the analyzer on the partial transcript once the candidate has been silent for about 600 ms, and discard the result if they resume. This can let the steering note land before the reply. Not in v1: it is racy.

---

## Turn-taking: when the interviewer speaks

The engine is the only turn authority: OpenAI's voice activity detection reports speech, and the engine decides from event timing whether to reply, wait or stop.

| From | To | When |
|---|---|---|
| Interviewer speaking | Conversation mode | The reply finishes, or sustained speech of 450 ms or more (barge-in) |
| Interviewer speaking | (stays) | A cough or blip under 450 ms |
| Conversation mode | Interviewer speaking | End of speech: the reply fires at once |
| Conversation mode | Listening mode | The candidate asks for a minute, or `STRUCTURING` starts |
| Listening mode | Interviewer speaking | A hand-back is detected, or the think timer's check-in |

Conversation mode replies at once; listening mode waits for the candidate to hand the turn back. A cough never stops the interviewer, but a real interruption does within about half a second.

### Session settings

- `turn_detection`: `server_vad` with `create_response: false` and `interrupt_response: false`. The server reports speech but never replies or cancels on its own.
- One authority only. This repo has hit double replies three times when the server and another component both drove turns (commits `585d547`, `6e45e08`, `97840a0`).
- `idle_timeout_ms` stays unset; silence timers live in the engine.
- Input transcription: `gpt-realtime-whisper`, which this repo's previous Realtime pipeline adopted for better candidate transcripts.
- Events are deduplicated by item id, because the API emits both current and legacy names for the same event (commit `6e45e08`).

### Rules

| Moment | Engine rule | Cost |
|---|---|---|
| End of speech, conversation mode | Fire `response.create` at once | One engine-to-OpenAI round trip |
| End of a very short utterance (under about 300 ms) | Wait for the transcript: words → reply; empty or noise → delete the item and stay silent | A few hundred ms, only on those turns |
| Speech while the interviewer is talking | Under 450 ms (a cough, a keystroke): keep talking and delete the blip item. Sustained: cancel the response, clear the output audio, and let OpenAI truncate at what was played | Up to 450 ms before stopping, the gate today's pipelines already use |
| End of speech, listening mode | Wait for the transcript and the analyzer. Hand-back (a question, "I'm ready", a finished framework) → reply; still thinking → stay silent | About 1–1.5 s, only in listening mode |
| A committed turn with no reply 1.5 s later, conversation mode | A watchdog fires one and logs it | A safety net against dead air |

Listening mode starts when a fast keyword check on the transcript (minute, moment, let me think, structure), confirmed by the analyzer, catches a request for time, or when the `STRUCTURING` stage begins. It ends on a hand-back or at the think timer's check-in.

---

## Who decides what

The voice model decides wording; the engine decides everything that needs a rule, a timer or a secret.

| Decision | Owner | Mechanism |
|---|---|---|
| Wording, tone, phrasing | Voice model | Persona plus steering note |
| What to say next (content move) | Voice model, guided | Steering note from the previous turn's analysis |
| Whether and when to reply | Engine | Turn-taking rules on voice activity events (see Turn-taking) |
| When to speak unprompted (nudge, time check, wrap-up) | Engine | Deterministic timers |
| Which facts may be disclosed | Engine | `lookup_fact` gate |
| Hints, from the voice or the Hint button | Engine | `request_hint` gate; the Hint button is routed through it |
| Stage transitions | Engine | Small talk to case: the interviewer calls start_case. Later stages: rules over analyzer output |
| Drift detection | Analyzer classifies; engine counts and decides | One free detour, then redirect |
| Tree coverage and belief | Analyzer plus engine | Updated each turn |
| Barge-in | Engine | 450 ms sustained-speech gate, then cancel |
| Leak prevention | Engine, layered | Four layers, below |

### Four-layer leak defence

1. **Not in context.** Withheld facts, the answer key, `truth` flags and priors are never sent to the voice model, and never appear in any API response while the session is active.
2. **Gated.** `earn` facts and hints come only through tools; the engine can answer `declined`.
3. **Live monitor.** Scan the interviewer's transcript stream for self-answering ("I'd start by…"), forbidden terms and any number outside the given and disclosed facts; on a hit, cancel, clear the audio and re-ask safely. This is a net, not a wall: some audio may already have played.
4. **Audit.** A post-session check, reusing the logic in [supervisor.ts](../server/modules/voice/supervisor.ts), feeds reports and evals.

### The steering note

A short note (about 80 tokens at most), added as a system message at the end of the conversation; the previous note is deleted, so only one exists. The instructions never change mid-session: OpenAI's cost guide warns that changing them lowers the cache rate, and for `gpt-realtime-2` cached audio input costs $0.40 per million tokens against $32 uncached. The note carries only candidate-side facts and generic move types, never an undiscovered driver. It also restates the core rules (the candidate leads; no approach, no unasked facts, never answer your own question), because in the second voice test rules placed only at the top of a long context were ignored.

```
[ENGINE NOTE · turn 14 · stage ANALYSIS]
Candidate is exploring Costs. Covered: revenue (price, volume). Nothing quantified yet.
Next move: ask them to quantify before going deeper. Hints used 0/3. 21 min left.
Avoid repeating openers: 'Great', 'Interesting'.
```

**Known cost:** in conversation mode, content-dependent steering lags one turn. Facts and hints are same-turn because they go through tools, and in listening mode the analyzer runs before the reply, so steering is same-turn there. If scenario tests show the lag is too loose, speculative analysis during the silence window is the fallback.

---

## Memory and cost over a session

A 30-minute interview fits easily in the 128,000-token context of `gpt-realtime-2`. Cost, not memory, is the constraint, and prompt caching is what keeps it low.

| Fact | Value | Source |
|---|---|---|
| Context window, `gpt-realtime-2` | 128,000 tokens; 32,000 max output | Model page |
| Interview length today | Up to 30 minutes: every plan caps an interview at 30, and a low balance reserves less | `plans.service.ts`, `wallet.service.ts` |
| Audio tokens | Candidate 1 per 100 ms; interviewer 1 per 50 ms | Cost guide |
| Rough 30-minute total | About 18,000 audio tokens if the candidate speaks half the time and the interviewer a quarter | Estimate |
| Audio input price | $32 per million tokens uncached, $0.40 cached | Model page |
| Audio output price | $64 per million tokens | Model page |
| Revenue per interview | About ₹300 on Starter (₹1,499 for 150 minutes, before GST) | `plans.service.ts` |

- Every reply re-reads the conversation so far, about 60–70 times in a session. With the cache working, most of that input is billed at the cached rate. The independent review estimated about $1–2 per session cached against about $20 uncached; neither figure is measured yet.
- So the instructions never change mid-session, the note is a conversation item, and truncation stays at its default unless measurements say otherwise.
- High reasoning effort adds output tokens; include it in the measurement.
- Phase 0 logs `response.done` usage (cached input, uncached input and output tokens) per session and sets a cost budget before the pilot.

---

## Conversation stages

Eight stages drive pacing: the engine grows more patient as the conversation moves from quick questions to a candidate thinking aloud. The figures are starting points to tune.

| Stage | Entry | Exit | Turn mode | Silence window |
|---|---|---|---|---|
| `GREETING` | `audio_live` and the echo check | Greeting done | Conversation | Snappy, about 600 ms |
| `INTRO` | Greeting done | When the interviewer judges small talk done and calls start_case; the engine only nudges her at about 3 and 5 minutes. The case brief enters the conversation only now | Conversation | Snappy |
| `CASE_PROMPT` | Intro done | Prompt delivered | Interviewer speaking; a cough doesn't stop it | Not applicable |
| `CLARIFY` | Prompt delivered | Candidate wants to structure, or 2 turns with no question | Conversation | Snappy, about 700 ms |
| `STRUCTURING` | Clarify exit | Hand-back with a framework, or time budget | **Listening** by default | Patient, about 1,500–2,000 ms |
| `ANALYSIS` | Structuring exit | Recommendation attempted, or time | Conversation; listening when they ask for time | Medium, about 1,000–1,300 ms |
| `SYNTHESIS` | Recommendation attempted | 1–2 follow-ups done | Conversation | Patient, about 1,500 ms |
| `WRAP_UP` | T-2 min or synthesis done | Session ends | Conversation | Snappy |

- Silence settings and turn mode change at stage entry only, never mid-utterance.
- The default is `server_vad`. `semantic_vad` is an A/B candidate, but this repo's own history records that it felt erratic before, so don't assume it is better.
- The stage budget comes from the session's reserved minutes, at most 30 today. For 30 minutes: intro 1–2, prompt and clarify 4, structuring 4, analysis 15–16, synthesis 3, wrap-up 1–2. Shorter reservations scale down, with a minimum to start (10 minutes proposed). A stage that overruns gets a time check, not a cut-off.

---

## Scenario playbook

The engine handles 29 situations; most ride the fast path, and only earned facts, hints, listening mode and timers add steps.

**Path:** F = fast (the engine fires the reply at end of speech, no LLM wait) · L = listening mode (waits for a hand-back) · T = tool turn · P = proactive (engine-issued) · V = voice activity or transport.

| # | Scenario | Detected by | Engine action | Candidate hears | Path |
|---|---|---|---|---|---|
| 1 | On-track answer, promising branch | Analyzer: node match, high prior | Update coverage; note says deepen or quantify | Brief acknowledgement and a follow-up | F |
| 2 | Short answer: "yes", "no", "okay" | Utterance under about 300 ms | Hold for the transcript; words found, so reply | A natural reply, a beat later | F |
| 3 | Basic clarifying question (a `give` fact) | Fact is in the instructions | None | Instant answer | F |
| 4 | Targeted clarifying question (an `earn` fact) | Model calls `lookup_fact`; match above threshold, prerequisites met | Return the fact; mark it disclosed once heard | The figure, naturally | T |
| 5 | Fishing: "is it a cost problem?" | Resolver: `withhold` or too early | Return `declined` plus a turn-back suggestion | "What would you want to look at to figure that out?" | T |
| 6 | Question outside the facts | Resolver: no match | Return `unknown`; ask for an assumption | "What would you assume?" | T |
| 7 | Candidate states an assumption | Analyzer: type = assumption | Check against case ranges; accept or challenge; log | "Reasonable, go on" or "Why that number?" | F plus note |
| 8 | **"Give me a minute"** | The interviewer calls wait_for_candidate (phrase rules as backup); the analyzer in listening mode | Interviewer acknowledges; engine enters listening mode and checks in at the time asked for ("15 seconds" → about 18 s, "a minute" → 63 s) | "Sure, take your time." … silence … "Ready when you are. Shall we continue?" | F, then L |
| 9 | **Thinking aloud while structuring** | `STRUCTURING` runs in listening mode | Each pause is checked: still thinking → silent; hand-back → reply | Silence while they work; a reply once they finish | L |
| 10 | Silence with no request | No speech 25–30 s after the interviewer's audio ends | A check-in about the person, never the case; 40 s later an offer to repeat the question; then silence | "Take your time. Are you still with me?" | P |
| 11 | Stuck, "not sure", or 2 turns with no new node | Analyzer stuck flag plus counter | Next hint level, if budget allows | A graded hint | P or F |
| 12 | Spoken hint request | Model calls `request_hint` | Gate on budget and minimum gap, otherwise decline kindly; write a `[HINT]` entry | A hint, or "let me restate the question" | T |
| 13 | Hint button pressed | Node forwards `GET /sessions/:id/hint` to the engine | Same gate and ledger; the note tells the interviewer a hint is on screen | Hint text on screen | T |
| 14 | Off-scope drift | Analyzer: scope = off | One free detour; second time, a redirect note | "Let's bring it back to the profit question" | F plus note |
| 15 | Wrong branch (dead end) | Node status or low prior | Probe 1–2 turns, then the node's `redirect_if_wrong` | A pre-written question | F plus note |
| 16 | **Barge-in** | Speech over 450 ms while the interviewer is talking | Cancel the response and clear the output audio; OpenAI truncates at what was played | She stops mid-word; when they are ready she picks up where she was cut off | V |
| 17 | Cough or keystroke while the interviewer is talking | Speech under 450 ms | Keep talking; delete the blip item | Nothing; the interviewer carries on | V |
| 18 | Cough while nobody is talking | Utterance under about 300 ms with an empty transcript | Delete the item; no reply | Nothing | V |
| 19 | No headphones (echo) | Echo check before the case; repeated short interruptions | A `notice` suggesting headphones; WebRTC echo cancellation handles the rest | An on-screen tip | V |
| 20 | Unclear audio | Empty or garbled transcript for a turn whose reply is already on its way | Cancel the reply before it is heard, delete the turn and ask to repeat; a bare "hmm" cancels the reply and waits | "Sorry, could you say that again?" | F |
| 21 | "Are you an AI?" (sincere) | Analyzer: meta | Answer honestly and continue | "Yes, I'm an AI interviewer. Let's keep going." | F |
| 22 | "How am I doing?" | Analyzer: meta | Don't leak a score | "I'll share feedback at the end." | F |
| 23 | Interviewer starts answering her own question, or states a fact or number not yet asked for | Live monitor on the transcript stream | Cancel, clear the queued audio, hand the floor back; log it | A brief rephrase | V |
| 24 | Time checks | Timers at T-10 and T-2 min, from the reserved minutes | Proactive time check; at T-2 ask for the recommendation; close before the cap | "We have about two minutes. What's your recommendation?" | P |
| 25 | Recommendation delivered | Stage moves to `SYNTHESIS` | 1–2 follow-ups (risks, next steps), then close | A follow-up, then wrap-up | F |
| 26 | Long monologue (over 90 s) | Duration | Never interrupt the candidate; after they finish, summarise and probe | A natural reply | F |
| 27 | Connection drop (audio or UI socket) | WebRTC or socket close | Page re-offers or reconnects; engine starts a new call and rebuilds context from the instructions, latest note and recent transcript | A brief "welcome back" | — |
| 28 | OpenAI error | `error` or sideband close | Reconnect once; otherwise apologise, save the transcript, settle time used | "I'm having a connection issue…" | — |
| 29 | Analyzer slow or failing | 1.5 s timeout | Conversation mode: skip the note. Listening mode: fall back to the think timer | Nothing; the voice carries on | — |

---

## Human-like behaviour

Pacing and interruption handling do more for the human feel than clever wording, so most of these are engine rules, not prompt text.

- **Persona.** One named interviewer; 1–3 sentence turns; contractions; no lists or markdown; one question at a time. She is the interviewer, not a coach: a greeting, a line or two of professional small talk, then she moves to the case herself; off-topic talk is steered back.
- **Variety.** The engine tracks recent openers and passes an avoid-list, so the interviewer doesn't say "Great" every turn.
- **Pacing.** Stage-aware silence windows, and a listening mode that stays silent while the candidate thinks aloud; respects "give me a minute".
- **Short answers count.** A "yes" or "no" gets a reply; a cough or a keystroke doesn't.
- **Tool lead-in.** A very short natural lead-in before a tool call ("Good question —") so the round trip doesn't sound like dead air.
- **Memory.** The note carries the candidate's assumptions, so the interviewer can say "you mentioned churn earlier".
- **Interruption.** Stops when interrupted, then picks up where she was cut off, covering what the candidate missed, instead of starting over or losing her place.
- **No echo loops.** WebRTC playback lets the browser cancel the interviewer's own voice from the mic, so speaker echo no longer triggers false interruptions.
- **Time awareness.** Mentions time naturally at the checkpoints. Check-ins are about the person, never the case, and she never answers her own questions.
- **Honesty.** Never claims to be human when sincerely asked.
- **Not in v1.** Back-channels ("mm-hm") while the candidate talks.

---

## Accuracy design

Accuracy comes from three things: numbers computed in code, a validated tree, and a gate between the voice model and every earned fact.

### Case generation (offline)

A workflow, not a set of agents:

1. **Framework template** from a library. Version 1 is profitability: Profits → Revenue / Costs → price, units, mix → value chain. The casebook is cleared for use as the source; encode it as structured templates rather than pasted pages.
2. **Numbers first, in code.** The LLM picks scenario parameters; a small financial model computes revenue, cost lines and the profit change, so every figure reconciles.
3. **Instantiate the tree.** Per node: `prior`, hidden `truth` and `critical` flags, `probes[]`, `hints[L1..L3]`, `redirect_if_wrong`, `signals[]`, `triggers[]`.
4. **Fact list.** Each fact is tagged `give`, `earn` or `withhold`, with triggers, prerequisites and precomputed derived values. The casebook's "Initial questions" seed the categories.
5. **Validators in code.** Schema; sibling priors sum to 1; one or two truth paths; every `earn` fact reachable from a node trigger; no `give` fact or L1 hint contains the truth-leaf label; figures reconcile.
6. **Repair loop**, at most 2 rounds: validator errors go back to the generator.
7. **Smoke test.** A simulated strong and a simulated weak candidate run through the engine in text mode before the case is published.

**One canonical tree.** Generation writes the tree into `Case.referenceTree` in the schema [prompts.ts](../server/ai/prompts.ts) already uses (`id`, `label`, `status`, `insight`, `candidate_signal`, `redirect_if_wrong`, `critical`, `rank`). Node's report then grades against the same tree the interview used and never builds its own. Engine-only fields (priors, hints, triggers, facts) stay in `engine_cases`.

### At runtime

- The interviewer never does arithmetic. Expected quant answers are precomputed; `check_quant(value)` compares the candidate's number within a tolerance.
- A fact counts as disclosed only if the candidate heard it: words cut off by an interruption don't count.
- Hints, spoken or from the Hint button, all go through the engine's gate and are written as `[HINT]` transcript entries, the format the report already counts.
- Priors are authored judgment, not calibrated statistics. They order exploration and aim hints; they are not probabilities of truth.
- As facts are disclosed, the engine re-weights unexplored branches to choose the next probe and hint target.

### Evaluation

- **Text-mode simulator** over the pure reducer with scripted Realtime events and no network. Personas: strong, average, weak, silent, off-topic, adversarial ("just tell me the answer"), "give me a minute" spam, a thinker-aloud, and one-word answers. Metrics: leaks, hint-policy adherence, coverage accuracy, stage progress, wrongful replies during listening mode.
- **Live tests** from India over the production path, with and without headphones.
- **Production telemetry** per turn: model latency and felt latency at p50 and p95, tool-turn latency, analyzer latency and timeouts, and tokens per session (cached, uncached, output).

---

## Multi-agent: not at runtime

No. Use one voice agent, a deterministic engine and two narrow LLM functions.

| Reason | Detail |
|---|---|
| Latency | Every handoff is another model round trip or context transfer inside a live conversation. |
| Identity | The interviewer must be one consistent person; handoffs risk voice and persona drift. |
| The split isn't agent-shaped | It is talking (needs a low-latency audio-native model) versus tracking and deciding (mostly rules plus a small structured classification). |
| Testability | Policy in code is unit-testable. Policy negotiated between agents is not. |

### What runs instead

| Piece | Kind | Why it is not an agent |
|---|---|---|
| Voice interviewer | Realtime model plus tools | It is the one agent. |
| Turn Analyzer | Stateless, schema-bound LLM call | No memory, no tools, no autonomy: a function. |
| Fact resolver fallback | Stateless LLM call, only when embeddings are ambiguous | Same. |
| Policy, timers, hints, stages | Plain code | Deterministic. |

Multi-step LLM workflows are fine off the critical path: case generation (generate, code validators, repair), post-interview evaluation (already in Node), and a possible post-session coach.

There is also no LLM supervisor in the voice path. The existing supervisor is deterministic and observe-only for a reason: [supervisor.ts](../server/modules/voice/supervisor.ts) notes the `create_response` timing constraint.

**Revisit if** we add a second live persona (for example a partner who joins), tool domains that need different tool sets, or an analyzer that outgrows a single schema-bound call.

---

## Data model

Five changes in Mongo; Node's reports keep reading what they read today.

| Store | Change |
|---|---|
| `engine_cases` (new, secret) | `caseId`, `framework`, `version`, engine-only tree fields (priors, hints, triggers), `facts[]`, `quant`, `scope`, validator report. Never returned by Node. |
| `Case` | Add `engine?: 'v2'`. The canonical tree goes into `referenceTree`. Answer-key fields are projected out of every API response while a session is active; the Report page reads them after completion. |
| `Session` | Keep `transcript` in its current shape, ordered by conversation item rather than arrival time. Add a small `engineSnapshot`, `engineSummary` and `callId`. |
| `session_events` (new) | `sessionId`, `t`, `type`, `payload`: analyzer results, tool calls and decisions, timers, hints, nudges, latency marks, token usage. A separate collection keeps the Session document small; optional TTL. |
| `Setting` (global) | Add the engine pilot user list, editable through `PATCH /api/admin/settings` without a redeploy. |

---

## Failure handling

The rule: the brain failing never blocks the voice, and an error never ends a session without saving the transcript and settling credits.

| Failure | Behaviour |
|---|---|
| Analyzer timeout or error | Voice continues; the last note stays; event logged. In listening mode the think timer takes over. |
| Reply trigger missed | Watchdog: in conversation mode, fire a reply 1.5 s after a committed turn that got none, and log it. Dead air is worse than a slightly late reply. |
| WebRTC drops | The page re-offers; the engine opens a new call and rebuilds context from the instructions, the latest note and the recent transcript. |
| UI socket drops, including a Node deploy | The page reconnects; audio is unaffected. |
| Engine restart mid-session | Same as a WebRTC drop: a new call, with context rebuilt from the snapshot. |
| OpenAI Realtime error | One reconnect; otherwise apologise, save the transcript, settle time used. |
| Database slow or down | Audio unaffected; writes retry; the transcript is flushed before `end_session` is acknowledged. |
| Tool handler error | Return a safe `declined` result, so the model turns the question back instead of improvising a fact. |
| Time or credit cap | Wrap-up line at T-2 min, then close, not a silent cut. |
| Engine deploy | Drain: stop new sessions and let live ones finish, up to a limit. |

---

## Python implementation notes

A per-session actor with a pure reducer keeps the logic testable. The engine never carries audio, so Python's speed is not on the audio path at all.

- **Stack.** FastAPI and uvicorn (`uvloop`), `websockets` for the sideband, `httpx` for the SDP exchange, `motor`, `pydantic` v2, `orjson`, the `openai` SDK for analyzer calls, `structlog`. Verify TLS against the OS trust store (`truststore`); the spike hit certificate errors without it.
- **Call setup.** Refuse any offer that contains a data channel (`m=application`). Post the offer and the session config to `/v1/realtime/calls` as multipart fields with explicit content types, using the server-side key; read the call ID from the `Location` header; open `wss://api.openai.com/v1/realtime?call_id=…` as the sideband. The spike in `engine/spike/` does exactly this.
- **Per-session actor.** One asyncio task consuming a bounded inbox of commands: `SpeechStarted`, `SpeechStopped`, `InputCommitted`, `Transcript`, `OutputAudioStarted/Stopped`, `ResponseDone`, `ToolCall`, `TimerFired(id, gen)`, `AnalyzerResult`, `UiMessage`. A pure `reduce(state, cmd) → (state, effects)`; an effect executor does the I/O. The reply trigger and the barge-in gate are pure functions of event timestamps, so they run in microseconds and are unit-tested (`engine/spike/turns.py`).
- **Layout.** `engine/app/{gateway, call_setup, sideband, case_master, analyzer, tools, generation, store}` and `engine/tests/`. Same repo, separate Railway service, hosted next to OpenAI's Realtime endpoint.
- **Config.** `OPENAI_API_KEY`, `MONGO_URI`, `JWT_SECRET` (shared), `INTERNAL_SECRET`, `REALTIME_MODEL`, `ANALYZER_MODEL`.
- **Session length.** Realtime sessions cap at 60 minutes; interviews cap at 30.
- **Fallback transport.** If a network blocks WebRTC, relay audio over the existing WebSocket path with the same engine logic. Echo cancellation then needs headphones, and truncation is estimated from playback time instead of reported by OpenAI.

---

## What is verified, and what is not

The frontend gaps, session caps, answer-key leak and echo history are verified in the code. The remaining unknowns are specific Realtime behaviours, plus real latency and cost; all are phase 0 checks.

### Verified in the repo

- The frontend message set, audio format and the gaps listed under Frontend contract (`Session.tsx`).
- `GET /sessions/:id` and the `/cases` endpoints return the whole case document.
- Every plan caps an interview at 30 minutes (`plans.service.ts`), and `reserve()` can hold less (`wallet.service.ts`).
- The report counts hints from `[HINT]` transcript entries and builds its own `referenceTree` when one is missing (`report.service.ts`).
- Echo and double-reply history in commits `585d547`, `6e45e08`, `97840a0` and `264d289`; reasoning effort raised to high in `68dbef8`.
- Settlement is idempotent; the existing tree schema and supervisor design.

### Verified in OpenAI's docs

- `gpt-realtime-2`: 128,000-token context, 32,000 max output, prompt caching and configurable reasoning effort. Audio input costs $32 per million tokens uncached and $0.40 cached; output costs $64.
- Audio uses 1 token per 100 ms of input and 1 per 50 ms of output. Changing instructions mid-session lowers the cache rate. Truncation can be tuned with a retention ratio.
- WebRTC sideband: the call ID comes from the `Location` header, and a server connects to `wss://api.openai.com/v1/realtime?call_id=…` with its own key to listen to and steer the session.
- Out-of-band `response.create` (`conversation: 'none'`); per-response `instructions`; the tool-call flow (`function_call_output`, then `response.create`); `response.cancel`; `conversation.item.truncate`, automatic on WebRTC; sessions up to 60 minutes.
- `conversation.item.create` with `previous_item_id`, and `conversation.item.delete`, in the API reference.

### Verified by the phase 0 spike (19 Oct)

- The server-side SDP exchange works: a multipart POST of `sdp` and `session` to `/v1/realtime/calls` returned 201 with the call ID in the `Location` header, and the sideband attached with it on the first attempt.
- Over the sideband, system-role items, `conversation.item.delete`, `response.create`, `response.cancel` and `output_audio_buffer.clear` all work, and OpenAI truncates the cancelled item on its own.
- The sideband receives `output_audio_buffer.started` and `stopped`, so the engine knows when the interviewer is audible.
- A call works with no browser data channel. With one, the browser can rewrite the session, so the engine refuses any offer that contains a data channel.
- `gpt-realtime-whisper` and reasoning `high` are accepted. Each sideband round trip from a laptop in India took about 265 ms, which is why the engine is hosted next to OpenAI.

**First voice test (2.4 minutes, reasoning high, 1,000 ms silence window):** engine decision 0 ms; speech end to `response.created` 289 ms from India; speech end to first audio 1.38 s at p50; felt latency 3.4 s at p50, above the 1.4–2.1 s target; transcripts in 544 ms; voice activity events carry timestamps; barge-in worked. It also showed the interviewer starting the case straight away, ignoring "wait 15 seconds" and nudging with case content. The fixes are in the spike and in this plan's playbook.

**Second voice test:** the replies were not guarded. A question during small talk got the case instead of an answer; an inaudible answer got a reply in which the interviewer answered her own question and stated a fact nobody had asked for. Fixes now in the spike: a "shall we start?" handover; cancelling the reply when the transcript comes back empty (it lands about 0.5 s after end of speech, before audio starts at about 1.1 s); rules restated every turn; and a live guard on the interviewer's words. An offline replay of that session's events confirmed each fix.

**Third iteration, judgment over rules:** the turn counter and cap were replaced by two interviewer tools. In a live check she kept chatting naturally, said "Alright, let me pull up the case so we can dive in" when the candidate was ready, called `start_case` and presented the case; on "Can you give me twenty seconds?" she called `wait_for_candidate` and checked in after exactly 23 s.

**Fourth iteration, a real interviewer:** she now runs the agenda like an interviewer, not a coach (no preparation questions, she moves to the case herself, she steers off-topic talk back). When cut off, the engine tells her what the candidate missed and removes unheard queued messages from her memory; in a re-test she resumed exactly where she was cut off. The rules now separate running the interview (hers) from solving the case (the candidate's), which fixed "I can't continue on my own here". A greeting spoken twice turned out to be a `gpt-realtime-2` preamble repeated as the answer; simple engine-issued lines now run at minimal reasoning per reply, which OpenAI accepts and which removes the repeat.

Details and raw results: [engine/spike/README.md](../engine/spike/README.md).

### Not verified: the spike's remaining voice tests

- Felt latency at reasoning medium and a 700 ms silence window, the cache rate over a 10-minute session, and cost per session.
- Whether a cough stops her: on WebRTC, OpenAI cleared her audio the instant speech started, before the engine's 450 ms gate, even with `interrupt_response` off.
- Echo cancellation without headphones, and the opening, interruption and off-topic behaviour by voice.
- Cutting into a rambling answer mid-speech needs a streaming transcript; for now she redirects at the end of the turn.

### Decided on 19 Oct

1. Voices: OpenAI Realtime voices, with no ElevenLabs step.
2. Tree: per-branch plausibility priors plus a hidden truth path.
3. Casebook: cleared as the framework source.
4. Pilot: a per-case flag plus a per-user pilot list.
5. To confirm: audio over WebRTC with the engine on the sideband, this revision's main change.

---

## Build order

About 6–7 weeks to a pilot for one engineer with AI assistance, plus the security fix now. Treat the estimate as a planning guess until phase 0 measures latency and cost.

| Phase | What | Rough effort |
|---|---|---|
| Now | Project answer-key fields out of `GET /sessions/:id` and the `/cases` endpoints while a session is active; independent of the engine | 1–2 days |
| 0 | Spike: extend the demo with a sideband engine (reply trigger, barge-in gate, listening mode, note as a conversation item). Measure felt latency from India, cost per session from `response.done` usage, echo without headphones, and reasoning effort at low, medium and high. Automated API probes: done 19 Oct, all passing. Manual voice tests: pending | 3–4 days |
| 1 | Engine skeleton (gateway, call setup, sideband, actor, persistence) plus the frontend changes: WebRTC audio layer, reconnect, per-role transcript buffers, notices, echo check | 1.5–2 weeks |
| 2 | Generation pipeline for profitability: validators, facts, canonical tree | 1–1.5 weeks |
| 3 | Analyzer, policy, hints (including the Hint button route), timers, listening mode, the scenario playbook | About 1.5 weeks |
| 4 | Simulator evals, latency and cost telemetry, pilot flags, the settle endpoint, hardening | About 1 week |
| 5 | Pilot on flagged profitability cases for listed users | Ongoing |
| Later | More case types, back-channels, speculative analysis | — |

---

## Sources

OpenAI pages opened for this revision; code references point to this repo.

- [gpt-realtime-2 model page](https://developers.openai.com/api/docs/models/gpt-realtime-2): context window, pricing, features
- [Managing costs](https://developers.openai.com/api/docs/guides/realtime-costs): audio token rates, caching, truncation
- [Developer notes on the Realtime API](https://developers.openai.com/blog/realtime-api): `gpt-realtime` limits, 60-minute sessions
- [Webhooks and server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls): sideband connection by call ID
- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc): call setup, ephemeral keys, unified interface
- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations): out-of-band responses, truncation, tool flow
- [Voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad): VAD types and settings
