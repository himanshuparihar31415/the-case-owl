# Phase 0 spike: the interview engine on the WebRTC sideband

Throwaway code that answers phase 0's questions before the real engine is built
([plan](../../docs/interview-engine-architecture.md), "Build order"). Audio goes
browser ⇄ OpenAI over WebRTC; this server only steers, over the sideband.

| File | What it is |
|---|---|
| `turns.py` | The turn-taking rules from the plan, as a pure function (event in, effects out) |
| `test_turns.py` | 43 scenario tests: opening with no turn limit, the interviewer's tool calls, pauses mid-turn, one reply at a time, unclear turns, cough vs barge-in by voiced time, short "yes", requests for time, listening mode, nudge ladder, watchdog |
| `guard.py`, `test_guard.py` | The live guard (layer 3 of the leak defence) and its 8 tests: self-answering, unasked facts, and naming a branch of the case before the candidate does |
| `server.py` | aiohttp server: SDP exchange with the server-side key, sideband per call, probes, latency and cost logging |
| `evals.py` | Behaviour evals: 9 scenarios, each run N times against the same prompts, tools and engine rules as `server.py` (text in, audio out). A behaviour counts as fixed only when it passes every run |
| `client.html` | The test page: WebRTC call, live transcript, engine decisions, per-turn latency, cost, probe results |

## Run

```bash
uv run engine/spike/server.py
```

Then open http://localhost:8770 in Chrome (localhost is required for the mic). The key comes
from `OPENAI_API_KEY` or the repo's `.env` and never reaches the browser. Unit tests need no
dependencies:

```bash
cd engine/spike && python3 -m unittest test_turns.py test_guard.py
```

Behaviour evals (about $0.02 a run; transcripts go to `results/evals-*.json`). Run them after any
change to the instructions, tools or notes, before testing by voice:

```bash
uv run engine/spike/evals.py --runs 5
```

Each session writes `results/<time>-<call>.jsonl` (every event, both directions) and a
`-summary.json` with latency percentiles, counts, tokens, cost and probe results. `results/` is
gitignored because it holds transcripts.

## What it checks

**Automated probes** (Silent track, about 30 seconds, a few cents): connect, wait for "sideband
ready", press **Run API probes**, stay quiet, then **End and save results**.

| Open question from the plan | Probe |
|---|---|
| Does the server-side SDP exchange return the call ID? | `server_sdp_exchange`, `location_header_has_call_id`, `sideband_connect` |
| Do replies, cancels and deletes work over the sideband, and how is WebRTC audio stopped? | `sideband_response_create`, `sideband_response_cancel`, `output_audio_buffer_clear`, `item_delete` |
| Can the browser be kept from controlling the session? | `call_without_data_channel`; with the data channel on, **Browser control test** → `browser_can_control_session` |
| Are system-role items accepted, and do VAD events carry timestamps? | `system_role_item_create`; `vad_events_have_audio_ms` (needs speech) |
| Does the sideband see playback state? | `sideband_sees_output_audio_buffer`; if not, the page reports playback instead |
| Is `gpt-realtime-whisper` accepted, with reasoning set? | `session_update_transcription_and_reasoning` |

**Manual tests** (Microphone, headphones unless stated). Each takes 2–3 minutes; end the session
after each to get its summary.

1. **Opening.** Maya greets you and asks how you are; chat as you like. She follows your lead,
   answers your questions, and starts the case when she judges you ready: she calls `start_case`
   (the engine log shows it) and then presents the case. Keep chatting to see her steer you
   gently; the engine nudges her at about 3 and 5 minutes but never forces the case.
1a. **Unclear turns and guardrails.** Mumble or cough for a second during the case: she should
   ask you to repeat, not answer for you. Say only "hmm": she should wait. Try to bait her ("so
   what would you do?", "what's the answer?"): she should hand it back. Any `guard:` line in
   the engine log means the live guard cut her off; note what she was saying.
2. **Latency.** Ten ordinary turns on the case. Record felt p50/p95. Repeat at reasoning medium
   and low, and try a silence window of 700 ms.
3. **Turn-taking.** Cough while Maya talks: she should continue. Say "wait" and keep talking for
   over a second: she should stop. Answer "yes": you should get a reply. Say "Just wait for 15
   seconds": she acknowledges briefly, stays silent, and checks in at about 18 seconds with a
   question about you, not the case. Say "Can you give me a minute?", then think aloud with pauses
   and say "okay" now and then: no replies (the engine log shows `listening: still_thinking`).
   Then "Okay, so my framework is…": she replies. Stay silent in normal conversation: at 25
   seconds "Take your time, are you still with me?", 40 seconds later an offer to repeat the
   question, then nothing more.
4. **Echo.** Five turns on laptop speakers, no headphones. Any self-interruption in the engine log
   is a fail.
5. **Cache.** Run test 2's script three times with **Steering note** set to **Conversation item**,
   **Conversation item, keep old notes** and **In instructions**. Compare the cached share and
   cost in the summaries.

## Reading the numbers

- **Decision** is the engine's own time from `speech_stopped` to sending `response.create`; it
  should be about 0 ms.
- **To response.created** includes one round trip between this server and OpenAI. Run locally in
  India that round trip crosses to OpenAI and back; in production the engine sits next to OpenAI,
  so subtract your measured round trip for a production estimate.
- **Felt** is measured in the browser, from the last moment your mic level was above threshold to
  the first interviewer audio. It includes the silence window (default 1,000 ms) and is the
  number the candidate experiences.
- Cost uses gpt-realtime-2 list prices from OpenAI's model page (Oct 2026); input transcription
  is billed separately and not included.

## Known limits

- The case brief (with every fact) enters as one system message when the case starts. The spike
  tests timing and behaviour, not the fact gate, which is phase 1 work.
- Requests for time are the interviewer's call: she uses her `wait_for_candidate` tool, and the
  engine runs the timer. Phrase rules (`requested_wait_ms`) are a backup. In listening mode a small LLM (`gpt-4o-mini`, override with `ANALYZER_MODEL`) decides; the phrase
  rules take over if it errors or takes over 3.5 s.
- One session per page; no reconnect.
- The **Type a candidate turn** box sends a typed message as the candidate, for testing without a
  mic. Typed turns skip voice activity detection.

## Results

### Automated probes — 19 Oct 2026, two short sessions, about $0.09 total

| Probe | Result |
|---|---|
| Server-side SDP exchange (`/realtime/calls`, multipart `sdp` + `session`) | PASS: 201, 1.0–1.6 s |
| `Location` header returns the call ID | PASS: `/v1/realtime/calls/rtc_…` |
| Sideband connects with `call_id` | PASS, first attempt |
| `session.update` with `gpt-realtime-whisper` and reasoning `high` | PASS |
| Call works with no browser data channel | PASS |
| System-role conversation item | PASS: `conversation.item.added` |
| `conversation.item.delete` | PASS |
| `response.create` over the sideband (engine-issued greeting and probe) | PASS |
| `response.cancel` over the sideband | PASS: status `cancelled` |
| `output_audio_buffer.clear` over the sideband | PASS: `output_audio_buffer.cleared`, then OpenAI sent `conversation.item.truncated` on its own |
| Sideband receives `output_audio_buffer.started/stopped` | PASS: the page's playback fallback is not needed |
| Browser can change the session when it has a data channel | **YES**: a `session.update` sent from the browser changed the instructions |
| VAD events carry `audio_start_ms` / `audio_end_ms` | Needs the mic test |

Findings:

- **Reject offers that contain a data channel.** With one, the browser can rewrite the session.
  A user can add one to their own offer, so the engine must refuse any SDP offer with an
  `m=application` section rather than rely on the page not asking for one.
- Each sideband round trip from this laptop took about 265 ms (`item.added`, `item.deleted`,
  `response.created`): the trip to OpenAI and back. In production the engine sits next to
  OpenAI, so this shrinks; it is why the plan hosts it there.
- Prompt caching showed 0% on the first two responses and 33% on the third (704 of 2,103 input
  tokens) once the context passed about 1,100 tokens. Longer sessions should cache more; the
  cache test below measures it.
- The engine-issued greeting cost about $0.025 (275 text tokens in, about 340 audio tokens out).
- Two client-side fixes were needed: Python must verify TLS with the OS trust store
  (`truststore`), and the `/realtime/calls` body must be multipart with explicit content types.

### First voice test — 19 Oct 2026, 2.4 minutes, reasoning high, silence 1,000 ms, note as item

| Measure | Target | Measured |
|---|---|---|
| Felt latency, conversation, p50 / p95 | about 1.4–2.1 s at p50 | **3.4 s / 9.4 s (miss)**, n = 6 |
| Engine decision (speech end to `response.create` sent), p50 | about 0 ms | 0 ms |
| Speech end to response.created, p50 | one round trip | 289 ms (laptop in India to OpenAI) |
| Speech end to audio start (engine clock), p50 / p95 | — | 1.38 s / 3.02 s |
| Transcript latency (committed to transcript), p50 | under 1 s | 544 ms |
| VAD events carry `audio_start_ms` / `audio_end_ms` | — | yes |
| Sustained barge-in | stops within about 0.5 s | worked, 3 times |
| Cached share of input | rising over a session | 41% over 2.4 minutes |
| Cost | set the budget from this | $0.215 for 2.4 minutes; uncached audio input was the largest line |

Felt latency breaks down as about 1.0 s of silence window, 0.29 s for the round trip to OpenAI
(it shrinks when the engine is hosted next to OpenAI), and about 1.1 s of model time at high
reasoning. The next run should try reasoning medium and a 700 ms silence window.

**Behaviour problems found, and the fixes now in the spike:**

| Problem | Cause | Fix |
|---|---|---|
| Maya started the case straight after "hello" | The spike's greeting prompt told her to present the case, and the case sat in her instructions | An opening stage: greet, ask how they are, small talk within guardrails. The case brief enters only when the engine moves to the case: after two turns, or when the candidate says they are ready |
| "Just wait for 15 seconds" was ignored, so a generic nudge fired at 25 s | The phrase rules only knew "give me a minute" | Waits, holds, stops and named durations are recognised; "15 seconds" means a check-in at about 18 s; the engine stays silent until then |
| Nudges pushed case content and she answered her own question | The nudge prompt asked how they were thinking about the case | A two-step ladder about the person ("Take your time, are you still with me?", then an offer to repeat the question), then silence; the instructions forbid answering her own questions or volunteering analysis |
| An "Okay" while waiting got a reply | Listening mode was never entered | In listening mode a small LLM classifies each utterance; "okay" is still thinking, so there is no reply |

Checked after the fixes (silent track): she now opens with "Hi, I'm Maya, welcome, and I'm
really glad you're here. How are you doing today?", and the first nudge is "Take your time. Are
you still with me?" The analyzer classified five sample utterances correctly in 0.7–1.2 s
(2.6 s on a cold connection).

### Second voice test — 19 Oct 2026: the replies were not guarded

| What happened | Cause | Fix now in the spike |
|---|---|---|
| "What do you mean by where are you joining from?" got the case instead of an answer | The case started after exactly two turns of small talk, whatever was said | She answers, asks "shall we start?", and starts only on a yes (or after 4 turns) |
| An inaudible answer got a reply in which she answered her own question | The reply fires at end of speech, before the transcript; the model filled the gap | An empty transcript arrives about 0.5 s after end of speech, before audio starts at about 1.1 s: the engine cancels the reply, deletes the turn and asks to repeat. A bare "hmm" cancels the reply and waits |
| She proposed the approach ("compare cost buckets") and stated unasked facts ("visits are flat") | The rules sat only at the top of a long context; the spike puts facts in the case brief | The rules are restated at the end of the context every turn, and the live guard cuts her off when she starts answering herself or states an unasked fact. In phase 1 facts sit behind the tool gate, so she cannot volunteer them |

An offline replay of this session's events through the server code confirmed: the inaudible turn
is cancelled and a repeat is asked; the self-answer is caught at "visits are flat", before
"I'd start by"; a clean reply is left alone.

### Third iteration — 19 Oct 2026: judgment over rules

The turn counter and the 4-turn cap are gone. The interviewer now judges the flow and acts
through two tools; the engine carries out the result and keeps hard rules only where they are
needed (answers and facts, unheard turns, timing, the hint budget, the time cap, security).

| Tool | When she calls it | What the engine does |
|---|---|---|
| `start_case` | Small talk has reached a natural end and the candidate is ready | Returns the case brief as the tool result (so the case cannot appear earlier) and lets her present it |
| `wait_for_candidate(seconds)` | The candidate asks for time, to wait, or to stop | Enters listening mode and checks in after the time asked for, plus 3 s |

If small talk runs long, the per-turn note nudges her at about 3 and 5 minutes to steer toward the
case in her own words; nothing forces it.

Live check with typed turns (1.6 minutes, about $0.09, 55% cached): she answered "How about
you?" and kept chatting; on "I'm ready whenever you are" she said "Alright, let me pull up the
case so we can dive in", called `start_case` and presented the case; on "Can you give me twenty
seconds?" she said "Sure, take your time", called `wait_for_candidate`, and at exactly 23 s
checked in with "Ready when you are. Shall we continue?"

### Fourth iteration — 19 Oct 2026: a real interviewer, and picking up after interruptions

| What happened in the voice test | Cause | Fix now in the spike |
|---|---|---|
| "How's your preparation going?" and "are you ready?" twice: she acted like a coach waiting for permission | The instructions listed preparation as small talk and said "follow their lead" | She is the interviewer and runs the agenda: a line or two of professional small talk, then she moves to the case herself. No coaching, no preparation questions; off-topic talk is steered back |
| After "give me 10 seconds… continue from there", she asked "What would you like to look at first?" | Nothing told her she had been cut off 9.6 s into the case, or that you missed the rest | When she is cut off, the engine estimates what you heard, deletes queued messages you never heard from her memory, and tells her what you missed. Re-test: cut off 5 s into the case, she resumed with "No problem. It fell from 6 million to 4.5 million…" |
| "I can't continue on my own here" | The rule "never carry on by yourself" was meant for solving the case; she applied it to resuming her own explanation | The rules now separate running the interview (hers: presenting, facts, probing, resuming) from solving the case (yours) |
| The greeting was spoken twice (4 of 4 sessions) | gpt-realtime-2 spoke a preamble ("commentary") and then the same words as its answer ("final_answer") | Simple engine-issued lines (greeting, wait acknowledgement, check-in, nudge, repeat request) run at minimal reasoning per reply: one message, reasoning tokens 39 → 6, and faster. Truncating the repeat was tried first; it does not stop audio already queued on WebRTC |

Also found in the log: OpenAI cleared her audio the instant you started speaking, before the
engine's 450 ms gate could act, even with `interrupt_response` off. On WebRTC, whether a cough
stops her therefore depends on OpenAI's voice activity detection. The cough test below settles
it; a fallback is raising the detection threshold while she is speaking.

Not possible yet: cutting into a rambling answer mid-speech. Transcripts arrive only after the
candidate stops, so the engine cannot judge an answer while it is still being spoken. She
redirects at the end of the turn for now; interjecting needs a streaming transcript (later).

### Fifth iteration — 19 Oct 2026: root causes instead of patches

The fourth iteration's fixes did not hold in the next voice test. The greeting was spoken twice
again; "Nice, let" was left on screen and in her memory; "How about you?" was ignored; and
"I just got a call, can you repeat?" got "I couldn't quite hear you". Each earlier fix had been
checked once by voice, and the model is not deterministic, so one good run proved nothing.

| Symptom | Root cause (from the event log and repeated runs) | Fix |
|---|---|---|
| Greeting said twice | Not reasoning. `start_case` was callable during the greeting, and "Start the interview now" read as a cue to call it. Speech before a tool call is a "commentary" preamble, and on WebRTC every generated word is played. With the tool available, 5 of 7 greetings were spoken as a preamble, went straight to `start_case`, or skipped the greeting | Speech-only replies (greeting, check-ins, nudges, repeat requests, tool follow-ups) are sent with `tool_choice: none`. Tools are called silently, and she speaks once after the result (the engine asks for one follow-up). Instructions: no preambles. Greetings: **0 preambles in 80 runs** |
| "Nice, let" stayed in the conversation | A 1 s pause ended the turn. When the candidate kept talking, the barge-in gate cancelled the reply before any audio, but its text stayed in her memory and on screen. Only replies that had started playing were cleaned up | One rule: **the conversation equals what the candidate heard.** When a reply ends cancelled, every item that never played is deleted (and removed on screen). Tool calls run only if their reply completed. Verified live: removed at 550 and 850 ms; trimmed with a note at 700 ms, once audio had started |
| "How about you?" ignored | The orphaned "Nice, let" made her think she had already answered. The case brief also said "go straight into the case" | Fixed by the rule above, plus "respond to what they actually say" and "answer anything they asked first" in the brief |
| "I couldn't quite hear you" when asked to repeat | The only repeat rule in her instructions was about her not hearing the candidate | Two separate concepts: she missed what they said (ask them to repeat), or they missed what she said (repeat it, and don't claim a hearing problem) |
| Steering note one turn late | The note was written after the transcript, which arrives after the reply has started | The note now goes in just before the reply it steers |
| Asked for help: hinted "revenue or costs" (2 of 5), and said "solving the case is your job" | No concept of how to respond when the candidate is stuck; the rules were phrased so she repeated them aloud | Encourage them to share their own thinking, point nowhere, and keep the rules private. The guard now also catches naming the cost branch before the candidate does, and no longer flags open invitations such as "you might start anywhere" |

Defaults are now `gpt-realtime-2.1` (the July update to gpt-realtime-2, same price, better
silence, noise and interruption handling) at reasoning `low`, OpenAI's production default. In
evals, first audio p50 is about 0.8–1.1 s, against 1.4–2.4 s at `high`. The fixes are not
model-specific: gpt-realtime-2 also passed every scenario (27 of 27). There is a new "Turn
end: semantic" option, where a model judges whether the candidate has finished, so a pause
mid-thought need not end the turn. It has not been voice-tested yet.

Evals after the fixes (gpt-realtime-2.1, low): greeting, small-talk question, moving to the
case, repeat request, asking for time, asking for a fact, asking for help, off-topic, and
resuming after an interruption all passed **45 of 45** runs.

### Sixth iteration — 19 Oct 2026: pauses, overlap and noise (voice test at 14:30)

The prompt fixes held: one greeting, she answered "how about you" when she heard it, she
resumed with "As I was saying", and "give me 10 seconds" got a check-in on time. The turn
rules did not hold:

| Symptom | Root cause (from the event log) | Fix |
|---|---|---|
| "I'm good, doing good also. So…" (about 1.2 s pause) "…how about you?" was ignored, and the case played over you | The engine counted itself busy only once OpenAI confirmed a reply, about 300 ms after asking. You went on 150 ms after it asked, so nothing stopped the reply. It called `start_case`, and the case began while you were still talking | Busy from the moment a reply is requested. If you speak before hearing any of it, it is cancelled, even before OpenAI has created it, and the next reply covers your whole turn |
| `Conversation already has an active response in progress` in Engine decisions | Your follow-up committed while the case presentation, started by the tool's follow-up outside the turn rules, was still generating. OpenAI rejected the second reply, so your question got none | One reply slot. Every reply goes through it, including tool follow-ups, the guard and typed turns. An unheard reply gives way; one you are hearing finishes first. A tool follow-up never starts while you are talking, and if you are mid-turn it is folded into the reply to that turn |
| She talked over you ("digital coffee…") | Same window. OpenAI clears her audio only at the moment it detects your speech, so audio that starts afterwards plays over you | Nothing starts while you speak. Safety net: her audio starting while you speak is stopped |
| A noise 7 s into the repeated case cut her off, then "Sorry, I didn't catch that" ("I didn't ask anything") | OpenAI clears her audio on any detected sound, whatever `interrupt_response` says. It is a known, unresolved API issue. The engine's cough gate could never fire: `speech_stopped` arrives a full silence window (1 s) after the sound ends, so the 450 ms timer always expired first. The timestamps include the 400 ms padding and the silence window, so the noise looked 1.7 s long; it was voiced for 312 ms | Coughs are judged by voiced time when the sound stops: (end − silence) − (start + padding). Under 450 ms counts as a blip: the item is deleted and she carries on ("As I was saying…"), or the reply it cancelled is asked for again. No "didn't catch that" |

51 unit tests now replay these timings from the log (`PausesAndOverlap`,
`InterruptionsWhileInterviewerTalks`).

What this does not solve: OpenAI still stops her on any sound, so a cough costs about 2 s
while she resumes. Letting her talk through coughs needs the engine to own voice detection:
`turn_detection` off, a VAD in the browser (or on our media path), manual commits. That is a
phase 1 decision.

### Still to run

| Measure | Target | Measured |
|---|---|---|
| Opening by voice: she chats naturally and starts the case when you are ready | no case before you are ready | |
| Unclear turn during the case | asks to repeat, never answers for you | |
| Baiting ("what would you do?") | hands it back; guard hits logged | |
| Felt latency at the new defaults (2.1, low), silence 1,000 ms and 700 ms | about 1.4–2.1 s at p50 | |
| Pause mid-thought, then keep talking ("I'm good… how about you?") | no half reply; she answers both parts | |
| Same, with Turn end: semantic | fewer cut-in replies, latency still in target | |
| Cough during interviewer speech (OpenAI may clear her audio itself) | no stop | |
| Interrupt her mid-explanation, then say "continue" | she resumes where she was cut off | |
| Ramble off topic | she brings you back to the case | |
| Short "yes" | gets a reply | |
| "Wait 15 seconds" | silent, check-in at about 18 s | |
| Thinking aloud in listening mode | no replies | |
| Echo on speakers | no self-interruption | |
| Cached share: item vs item, keep old notes vs instructions | item variants clearly higher | |
| Cost per 10-minute session | set the budget from this | |
