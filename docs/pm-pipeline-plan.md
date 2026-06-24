# The Case Owl — PM Interviewer (STT → LLM → TTS) Implementation Plan

Status: **PLAN — awaiting approval. No code written yet.**
Spec source: "AI PM Interviewer Full System Specification v1.0" (17 sections).
Decision locked: **build the real STT→LLM→TTS pipeline**, not reuse the all-in-one Realtime conversation model.
Vendor decision (updated): **OpenAI for STT and TTS too** — no new vendors, no new keys. Deepgram/ElevenLabs deferred as a future swap if latency demands it.

---

## 0. Architectural decisions (confirm before build)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | New module vs reuse `product` | **Reuse `product`** — it already *is* the PM module (4 formats). Route by `Case.module === 'product'` to the new pipeline. | Avoids a duplicate module + duplicate Config UI. `case`/`guesstimate` stay on Realtime. |
| D2 | One WS endpoint vs new one | **One endpoint.** In `handleConnection`, branch: `product` → `handlePmPipeline()`, else → existing Realtime path. | Frontend connection code unchanged; clean fork on the server. |
| D3 | LLM for the per-turn call | **OpenAI `gpt-4o`** (already keyed), structured JSON output, `response_format: json_schema`. Swap to a faster model for trivial acks later (spec §3.1). | No new vendor; strong instruction-following; we control the prompt fully. |
| D4 | STT | **OpenAI Realtime API, transcription-only session** (`intent: transcription`) over WS — streaming partials + `server_vad` endpointing. Reuse the tuned VAD knobs (threshold `0.63`, `silence_duration_ms 1330`, `prefix_padding_ms 400`). | No new vendor/key; gives the "candidate stopped talking" signal with config we already proved out. |
| D5 | TTS | **OpenAI `gpt-4o-mini-tts`**, HTTP streamed, `response_format: pcm` @ 24 kHz, abortable for barge-in. | No new vendor; PCM 24k matches existing `AudioContext`; filler audio masks the slightly higher time-to-first-audio. |
| D6 | Audio format on the wire | Keep **PCM16 @ 24 kHz base64** browser↔server (unchanged). | Reuses the entire existing browser audio pipeline. |

**D1 — RESOLVED:** pipeline is **strictly for the `product` (PM) module**. `case` and `guesstimate` stay on the Realtime path, untouched.

---

## 1. New dependencies & config

- `package.json`: **no new packages** — OpenAI SDK + raw `ws` already present.
- `server/config/env.ts`: **no new keys** — only `OPENAI_API_KEY` (already there). Optional `OPENAI_TTS_VOICE` (default e.g. `alloy`/`cedar`) and `OPENAI_TTS_MODEL`.
- Future swap to Deepgram/ElevenLabs would re-add their keys here; not needed now.

---

## 2. Data model changes

`server/models/Session.ts` — extend `ISession` (all optional, additive, no migration needed):

```ts
turnAssessments?: Array<{
  t: string; stage: string; questionIntent: string; responseQuality: number;
  didAnswer: boolean; skillsDemonstrated: string[]; skillsMissing: string[];
  specificity: 'high'|'medium'|'low'; personalStory: boolean; userGrounded: boolean; notes: string;
}>;
stateObject?: Record<string, unknown>;          // final compact state at session end
stageTransitions?: Array<{ from: string; to: string; t: string; quality: 'clean'|'prompted'|'redirected' }>;
reprompts?: Array<{ originalT: string; repromptT: string; reason: string; attempt: number }>;
thinkingPauses?: Array<{ start: string; end: string; durationMs: number; stage: string }>;
integrityFlags?: Array<{ t: string; type: string; detail: string; severity: 'low'|'medium'|'high'|'critical' }>;
interviewType?: 'pm' | 'consulting';
```

`server/models/Case.ts` — PM authoring fields (additive, `Mixed`):

```ts
productContext?: string;                          // §12.1.1
prompt?: string;                                   // §12.1.2 (the one PM question)
evaluationAnchors?: Record<string,{good:string}>;  // §12.1.3 per stage
followUpBank?: Array<{ trigger: string; probe: string }>; // §12.1.4
antiPatterns?: string[];                            // §12.1.5
```

`Report.analysis` is already a flexible JSON blob → the PM report shape rides on it, no schema change.

---

## 3. Server pipeline — file map

```
server/modules/voice/
  voice.ws.ts          ← add the D2 branch (product → handlePmPipeline)
  pm/
    pm.pipeline.ts      ← NEW orchestrator (the §3.2 flow)
    openai-stt.ts       ← NEW OpenAI Realtime transcription-only WS client (STT + VAD)
    openai-tts.ts       ← NEW OpenAI gpt-4o-mini-tts streaming client (abortable)
    pm.state.ts         ← NEW state machine + state object + compression (§5, §8)
    pm.turn.ts          ← NEW per-turn LLM call + JSON schema (§6, §7)
    pm.integrity.ts     ← NEW PM integrity signals (§13)
    filler/             ← NEW pre-recorded filler audio (mp3/pcm) (§15.1)
```

### 3.1 `pm.pipeline.ts` — the orchestrator (replaces the Realtime socket for PM)
Lifecycle per connection:
1. Auth + load session/case (reuse existing logic from `voice.ws.ts`).
2. Open the **OpenAI transcription WS** (`openai-stt.ts`); TTS is a per-turn HTTP stream (`openai-tts.ts`), no persistent socket.
3. Init `PmState` (stage = `clarification`, empty journey).
4. **Greeting turn**: on client `audio_live`, run LLM once with empty transcript → TTS → stream to client (mirrors current `fireGreeting`).
5. **Client → server** `audio_chunk` (PCM16 b64): forward via `input_audio_buffer.append` to the transcription WS. (Gate until greeting done, same as today.)
6. **STT WS → server**: `...transcription.delta` → forward as `transcript_delta` (candidate); `input_audio_buffer.speech_started` → barge-in; on `server_vad` turn-end (`...transcription.completed`) → turn complete:
   - **Immediately** play a filler clip (`filler_audio` message to client) — §15.
   - If candidate is mid "thinking pause" (said "let me think"), apply the **90s** silence threshold instead of ending the turn (§9, §15.2).
7. **LLM turn** (`pm.turn.ts`): build prompt from `PmState` + last-5-turns + case context + candidate transcript → single `gpt-4o` JSON call.
8. Parse JSON → `{ response, turn_assessment, next_action, state_update }`:
   - Persist `turn_assessment` to `session.turnAssessments`.
   - Apply `state_update` to `PmState`; log `stage_transition` if stage advanced.
   - Run `pm.integrity.ts` → push any `integrity_flags`.
9. **TTS** (`openai-tts.ts`): stream `response` text to `gpt-4o-mini-tts` → `audio_chunk` frames to client (same message type the browser already plays).
10. **Barge-in**: if the STT WS reports `speech_started` during TTS playback → send `speech_started` to client (stop playback), `abort()` the in-flight TTS HTTP stream.
11. **Hard cap timer** + **settleSession** on close: reuse existing logic verbatim.

### 3.2 `openai-stt.ts`
- Connect `wss://api.openai.com/v1/realtime?intent=transcription`; on open send a transcription-session config: `input_audio_transcription.model: gpt-4o-transcribe`, `turn_detection: server_vad` with the tuned knobs (threshold `0.63`, `prefix_padding_ms 400`, `silence_duration_ms 1330`).
- Forward client audio via `input_audio_buffer.append`.
- Emit events: `partial(text)` (delta), `final(text)` (completed), `speechStarted()`.
- Thinking-pause handling lives in the orchestrator: during an explicit "let me think", we simply don't treat VAD silence as a turn-end until ~90s (§9) — no STT reconfig needed.

### 3.3 `openai-tts.ts`
- `POST /v1/audio/speech` with `{ model: gpt-4o-mini-tts, voice, input, response_format: 'pcm', stream: true }`; read the chunked PCM body, base64 each chunk → forward as `audio_chunk`.
- Expose `abort()` (AbortController) for barge-in.

### 3.4 `filler/` (§15.1)
- A few pre-rendered clips per category: acknowledgment ("Mm-hmm", "Right"), thinking ("Let me think about that"), transition. Stored as base64 PCM or served once at session start.
- Orchestrator picks a category based on `next_action` and plays instantly on turn-end, before the LLM returns. Categories + selection logic from §15.1.

---

## 4. Conversation engine — the per-turn LLM call (§6, §7)

`pm.turn.ts`:
- **Prompt template** = §6.1 verbatim, filled from `PmState`.
- **Structured output** via `response_format: { type: 'json_schema', json_schema: PM_TURN_SCHEMA }` so `turn_assessment`/`next_action`/`state_update` always parse (§6.2 "why structured JSON").
- `PM_TURN_SCHEMA` mirrors §6.1 / §7.2 exactly.
- New prompt builders in `server/ai/prompts.ts`:
  - `PM_TURN_SYSTEM(caseCtx)` + `pmTurnUser(state, recentTurns, transcript)`.
  - Personality/behavioral rules from §9 baked into the system prompt (follow-don't-lead, affirm-before-probe, adaptive difficulty by `session_quality_trend`, "I don't know" ladder, thinking pauses positive).
- New AI client fn in `server/ai/client.ts`: `pmTurn(messages, schema)` → typed object.

---

## 5. State machine & context management (§5, §8)

`pm.state.ts`:
- `PmState` class holding the §8.2 state object (product, prompt, chosen_user, pain_points[], solutions[], metrics[], current_stage, stages_completed/remaining, coherence_checks[], session_quality_trend[]).
- Stages enum (§5.1): `clarification → user_identification → pain_points → prioritization → solutions → solution_deep_dive → metrics → risks → summary`.
- Transition rules (§5.2): in-order with allowances for combine/skip/circle-back/deep-dive sub-state.
- **Coherence engine**: solutions↔pain_points, metrics↔solutions, user↔pain_points mapping → writes `coherence_checks` the LLM probes next turn (§6.2).
- **History compression** (§8.3): keep last 5 turns verbatim; every 10 turns regenerate a 2–3 sentence summary from `turn_assessments` (cheap LLM call), never raw transcript. Keeps each call ≤ ~500 tokens of state.

---

## 6. Integrity layer (§13)

`pm.integrity.ts`:
- PM-specific signals (§13.2): quality cliff (sudden `responseQuality` drop), ungrounded assertion (`userGrounded=false` streak), knowledge inconsistency, fabricated specificity.
- Consumes `turn_assessment` stream; pushes `integrity_flags`; can inject a `coherence_check`/warning so the LLM asks a verification question next turn.
- Reuse the **loosened** integrity philosophy already adopted: default NORMAL, escalate only on sustained patterns (avoid the `fourth_wall_break` false-positive we already fixed).

---

## 7. Evaluation engine — PM report (§11, §14)

`server/modules/reports/report.service.ts` — add a `module === 'product'` branch:
- **Report writer, not judge** (§11.1): aggregate the live `turn_assessments`, don't re-score the transcript.
- Steps §11.3: dimension scoring (7 PM competencies §10, late-turn weighted) → critical moments → depth opportunities → coherence analysis → improvement plan (≤2).
- New eval prompt `PM_REPORT_PROMPT(ctx)` in `prompts.ts` producing the §14 sections:
  1. Integrity banner (conditional) 2. Overall + classification 3. Competency scorecard (7 dims, anchors, evidence turns) 4. Journey coherence map 5. Critical moments 6. Depth opportunities 7. Communication analysis 8. Time management 9. Improvement plan (≤2) 10. Progress over time.
- Stored in `Report.analysis` (flexible JSON, no migration).

---

## 8. PM case authoring (§12)

`server/ai/client.ts`: `generatePmCaseWithAI(format, difficulty)` →
`{ productContext, prompt, evaluationAnchors, followUpBank, antiPatterns, title }`.
`server/modules/cases/case.service.ts`: when `module==='product'`, populate the new Case fields.
New prompt `PM_CASE_PROMPT(format, difficulty)` in `prompts.ts` (§12.1.1–12.1.5).

---

## 9. Frontend (§14, §15)

- `src/pages/Session.tsx`:
  - Handle new `filler_audio` message (play instantly).
  - Longer "thinking" affordance: when interviewer says take-your-time, show a calm "Take your time…" state; don't show the AI as stalled.
  - PM module already hides the consulting STAGE bar (free-flow chip) — keep; optionally show PM stage chips.
  - Remove TEMP `[exhibit] received frame` log once PM path verified.
- `src/pages/Report.tsx`: PM report sections — **Journey Coherence Map** (Users→Pain→Solutions→Metrics with gap highlighting), Depth Opportunities, Communication analysis, 7-dim PM scorecard. Reuse existing report component patterns.
- `src/pages/Config.tsx`: product module already selectable; ensure it flags `interviewType: 'pm'` so the server routes to the pipeline. No new UI required.

---

## 10. Latency budget (§3.3) & risks

- Target perceived latency **1.5–2.5s**; filler audio masks LLM+TTS-start. Measure: endpoint→filler (<150ms), LLM first token, TTS first audio.
- **Risks:**
  - One extra WS (STT) + per-turn TTS HTTP stream = more failure modes → graceful `error` to client + settleSession on any close.
  - Cost: STT + LLM + TTS per turn vs one Realtime stream. Hard-cap timer (already exists) is the backstop.
  - Barge-in correctness: cancel TTS HTTP stream + ignore late audio chunks when `speech_started` fires — needs careful testing.
  - OpenAI TTS time-to-first-audio > ElevenLabs turbo; rely on filler audio to mask. If it ever feels laggy, D5 swaps to ElevenLabs without touching the rest.
  - JSON-schema parse failures (§17 target 95%+) → retry once, then log a degraded turn assessment.

---

## 11. Build phases (ship/verify in order)

- **P1 — Pipeline skeleton**: `openai-stt.ts`, `openai-tts.ts`, `pm.pipeline.ts` echoing a fixed greeting end-to-end (mic→STT→LLM→TTS→speaker). Verify audio round-trip + barge-in. (No new keys.)
- **P2 — Conversation engine**: `pm.turn.ts` + structured JSON + §9 personality. Verify natural multi-turn PM convo.
- **P3 — State + integrity**: `pm.state.ts` (machine, coherence, compression) + `pm.integrity.ts`. Verify state object stays small over 30 min.
- **P4 — Latency tuning + thinking-pause handling** (filler audio DROPPED — it interrupts the natural cadence; rely on the deliberate STT→LLM→TTS pause instead). Robust barge-in: only abort the interviewer on a sustained candidate utterance, not a stray VAD blip.
- **P5 — Evaluation/report**: PM report branch + `Report.tsx` sections.
- **P6 — Case authoring**: `generatePmCaseWithAI` + Config wiring.
- **P7 — Cutover**: feature-flag product→pipeline, remove temp diagnostics, docs.

Each phase is independently committable and leaves `case`/`guesstimate` (Realtime) untouched.
```
