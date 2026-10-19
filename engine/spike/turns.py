"""Turn-taking rules for the phase 0 spike: pure, no I/O, no clock.

The engine is the only turn authority. Server VAD runs with create_response and
interrupt_response off, so nothing replies or cancels unless these rules say so.
`handle(state, event)` takes one event and returns the effects to execute; the
server turns effects into Realtime client events and timers.

Judgment versus rules: the interviewer decides what should happen in the
conversation (when small talk is done, when the candidate wants time) and says
so through tools; the server turns those calls into `case_started` and
`tool_wait` events. This module keeps only what the model cannot do or must not
decide: timing (it has no clock), unheard turns, and barge-in mechanics.

Three invariants hold the turns together (all three were broken in the 19 Oct voice test):
- One reply at a time. A reply the engine wants waits for the slot; an unheard reply in the
  slot gives way to it. OpenAI rejects a second response.create while one is active.
- Never over the candidate. No reply starts while they are speaking, and a reply they have not
  heard yet is cancelled the moment they speak again: after a pause they were not finished.
- Busy from the moment a reply is requested, not from when OpenAI confirms it (~300 ms later).

Events:  start · speech_started{audio_start_ms} · speech_stopped{audio_end_ms} ·
         committed{item_id} · transcript{item_id, text} · analysis{item_id, intent, wait_ms} ·
         case_started · tool_wait{wait_ms} · say{reason, prompt?} · typed · response_created ·
         response_done · audio_started · audio_stopped · timer{kind, gen}
Effects: create_response{reason, prompt?} · cancel_response · clear_audio ·
         delete_item{item_id, reason} · analyze{item_id, text} · set_timer{kind, ms, gen} ·
         mode{mode} · stage{stage} · metric{name, ...}
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Voiced speech shorter than this, over or just before the interviewer, is a cough, a noise or an
# "mm-hmm", not a turn. Judged when speech stops: OpenAI's speech_stopped arrives a full silence
# window after the sound ends, so a timer from speech_started cannot tell a cough from a sentence.
BLIP_MS = 450
SHORT_UTTERANCE_MS = 300   # shorter turns wait for the transcript before any reply
WATCHDOG_MS = 1500         # a committed turn with no response by then gets one
THINK_MS = 63_000          # "give me a minute": a minute plus a little grace
HOLD_MS = 20_000           # "wait", "hold on", "stop": a short pause before checking in
WAIT_GRACE_MS = 3_000      # added to any duration the candidate names
MIN_WAIT_MS, MAX_WAIT_MS = 5_000, 300_000
NUDGE_MS = (25_000, 40_000)  # silence before the first and second check-in; then stop nudging
BUSY_RETRY_MS = 5_000      # a check-in that lands while the interviewer is talking waits this long

# Not "start the interview": with a tool called start_case, that reads as a cue to call it.
GREETING_PROMPT = "Greet the candidate now: introduce yourself and ask how they are, in one short message."
REPEAT_PROMPT = (
    "You could not make out what the candidate just said. Say so in a few words and ask them to repeat it, "
    "for example 'Sorry, I didn't catch that. Could you say it again?' Do not guess what they meant."
)
WAIT_ACK_PROMPT = (
    "The candidate asked you to wait. Acknowledge in two to five words, for example 'Sure, take your time.', "
    "then stop. Say nothing else."
)
# On WebRTC OpenAI clears her audio the instant it detects any sound, whatever interrupt_response says
# (a known, unresolved API issue), so the engine cannot let her talk through a cough. It resumes her.
RESUME_PROMPT = (
    "That sound was not the candidate taking a turn. Carry on from where you were cut off, bridging back in a "
    "few words, for example 'As I was saying, …'. Do not start over or comment on the noise."
)
CHECKIN_PROMPT = (
    "The time the candidate asked for has passed. Check in warmly in a few words, for example "
    "'Ready when you are. Shall we continue?' Do not ask a case question or offer analysis."
)
SPEAKING_WORDS_PER_S = 2.6  # rough speaking rate, to estimate how much of a cut-off reply was heard
NUDGE_PROMPTS = (
    "The candidate has been quiet for a while. Check on them as a person would, in a few words, for example "
    "'Take your time. Are you still with me?' Do not mention the case, ask a case question or offer analysis.",
    "The candidate is still quiet. Offer help without giving any content, for example 'No rush. Would it help "
    "if I repeated the question, or would you like a bit more time?' Do not answer for them or hint at the answer.",
)

NUMBERS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10, "fifteen": 15,
           "twenty": 20, "thirty": 30, "few": 3, "couple of": 2}
DURATION_RE = re.compile(r"\b(?P<n>\d+|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|few|couple of)\s+"
                         r"(more\s+)?(?P<unit>seconds?|secs?|minutes?|mins?)\b", re.I)
# A duration only counts as a request when it is addressed to the interviewer.
REQUEST_RE = re.compile(r"\b(give me|wait|hold on|hang on|i need|i'?ll need|can i (have|get|take)|"
                        r"let me (have|take))\b", re.I)
MINUTE_RE = re.compile(r"\b(give me|i need|i'?ll need|take|one|just|another)\s+(a|one|another|more|one more)?\s*"
                       r"minute\b|"
                       r"\bstructure my (thoughts|answer|approach)\b|\blet me (think|structure)\b", re.I)
HOLD_PHRASE_RE = re.compile(r"\b(hold on|hang on|wait a (moment|sec(ond)?|bit)|give me a (moment|sec(ond)?)|"
                            r"one sec(ond)?|just a (moment|sec(ond)?)|take a moment)\b", re.I)
HOLD_WORD_RE = re.compile(r"^\W*(wait|stop|pause|hold)\b", re.I)  # bare words: very short utterances only
HANDBACK_RE = re.compile(
    r"\?\s*$|\b(i'?m ready|ready now|okay,? so|ok,? so|so my (framework|structure|approach)|"
    r"that'?s my (framework|structure|approach)|i'?d (start|look|begin)|"
    r"i would (start|look|begin)|let'?s (start|begin|go)|here'?s my)\b",
    re.I,
)
SPEECH_RE = re.compile(r"[a-z0-9]", re.I)
FILLER_RE = re.compile(r"^\W*((u+h+m*|u+m+|h+m+|m+|a+h+|e+r+m*)\W*)+$", re.I)  # "hmm", "um", "uh"


def requested_wait_ms(text: str) -> int | None:
    """How long the candidate asked the interviewer to wait, or None if they didn't.
    The backup for the interviewer's wait_for_candidate tool."""
    words = len(text.split())
    match = DURATION_RE.search(text)
    if match and words <= 16 and REQUEST_RE.search(text):
        count, unit = match.group("n").lower(), match.group("unit").lower()
        n = int(count) if count.isdigit() else NUMBERS[count]
        if n == 1 and unit.startswith("s"):
            return HOLD_MS  # "a second" is an idiom for "briefly", not one second
        ms = n * (60_000 if unit.startswith("m") else 1_000) + WAIT_GRACE_MS
        return max(MIN_WAIT_MS, min(MAX_WAIT_MS, ms))
    if MINUTE_RE.search(text):
        return THINK_MS
    if HOLD_PHRASE_RE.search(text) or (words <= 3 and HOLD_WORD_RE.search(text)):
        return HOLD_MS
    return None


def wait_ms_for(seconds) -> int:
    """The think timer for a wait the interviewer asked for through her tool."""
    if isinstance(seconds, (int, float)) and seconds > 0:
        return max(MIN_WAIT_MS, min(MAX_WAIT_MS, int(seconds * 1000) + WAIT_GRACE_MS))
    return HOLD_MS


def heard_portion(text: str, heard_ms: int | None) -> tuple[str, str]:
    """Split a cut-off reply into the part the candidate probably heard and the rest.
    An estimate from speaking rate: OpenAI reports how many ms were played, not which words."""
    words = text.split()
    if heard_ms is None or not words:
        return "", text
    n = min(len(words), round(heard_ms / 1000 * SPEAKING_WORDS_PER_S))
    return " ".join(words[:n]), " ".join(words[n:])


def classify_fallback(text: str) -> dict:
    """Keyword stand-in for the LLM analyzer, used when it fails or times out."""
    wait = requested_wait_ms(text)
    if wait:
        return {"intent": "wants_time", "wait_ms": wait}
    if HANDBACK_RE.search(text):
        return {"intent": "hand_back"}
    return {"intent": "still_thinking"}


@dataclass
class TurnState:
    stage: str = "waiting"                # "waiting" -> "intro" -> "case" (the interviewer's start_case call)
    mode: str = "conversation"            # "conversation" | "listening"
    # VAD timestamps include the prefix padding and the silence window; subtract them for voiced time.
    prefix_padding_ms: int = 0
    silence_ms: int = 0
    candidate_speaking: bool = False
    assistant_audio: bool = False         # interviewer audio is playing
    reply_requested: bool = False         # response.create sent, response.created not seen yet
    response_active: bool = False         # a response is being generated
    cancelling: bool = False              # cancel sent for the active response
    cancel_on_create: bool = False        # cancel the requested response as soon as it exists
    current: dict | None = None           # the reply requested or generating: {reason, prompt, item}
    want: dict | None = None              # the next reply, waiting for the slot or for the candidate to finish
    cut: dict | None = None               # the reply their speech stopped, until we know if it was a blip
    speech_start_ms: int | None = None    # audio_start_ms of the current utterance
    blip_next_commit: bool = False        # the next committed item is a blip to delete
    last_duration_ms: int | None = None   # voiced duration of the last utterance
    nudges: int = 0                       # check-ins since the candidate last spoke
    reply_item: str | None = None         # the utterance the current reply answers
    awaiting: dict[str, str] = field(default_factory=dict)  # item_id -> "short" | "listening"
    gen: dict[str, int] = field(default_factory=dict)       # timer kind -> live generation


def handle(state: TurnState, ev: dict) -> list[dict]:
    kind = ev["type"]
    if kind == "timer":
        if state.gen.get(ev["kind"]) != ev["gen"]:
            return []  # cancelled or superseded
        return _on_timer(state, ev["kind"])
    fn = _HANDLERS.get(kind)
    return fn(state, ev) if fn else []


# --- helpers -----------------------------------------------------------------

def _timer(state: TurnState, kind: str, ms: int) -> dict:
    gen = state.gen.get(kind, 0) + 1
    state.gen[kind] = gen
    return {"do": "set_timer", "kind": kind, "ms": ms, "gen": gen}


def _cancel(state: TurnState, kind: str) -> None:
    state.gen[kind] = state.gen.get(kind, 0) + 1  # any pending timer of this kind is now stale


def _busy(state: TurnState) -> bool:
    return state.reply_requested or state.response_active or state.assistant_audio


def _reply(state: TurnState, reason: str, prompt: str | None = None, item: str | None = None) -> list[dict]:
    """Ask for a reply. It replaces any reply still waiting, and goes out once the slot is free and the
    candidate is not speaking."""
    state.want = {"reason": reason, "prompt": prompt, "item": item}
    return _pump(state)


def _pump(state: TurnState) -> list[dict]:
    want = state.want
    if want is None or state.candidate_speaking:
        return []
    if state.reply_requested or state.response_active:
        # An unheard reply gives way; one they are hearing finishes first.
        return [] if state.assistant_audio else _stop_reply(state)
    state.want, state.current, state.reply_item = None, want, want["item"]
    state.reply_requested = True
    eff = {"do": "create_response", "reason": want["reason"]}
    if want["prompt"]:
        eff["prompt"] = want["prompt"]
    return [eff, _timer(state, "watchdog", WATCHDOG_MS)]


def _stop_reply(state: TurnState) -> list[dict]:
    """Stop generating the current reply (requested or active). Playing audio is left alone."""
    if state.response_active:
        if state.cancelling:
            return []
        state.cancelling = True
        return [{"do": "cancel_response"}]
    if state.reply_requested:
        state.cancel_on_create = True  # it does not exist yet: cancel it when it does
    return []


def _abort_reply(state: TurnState) -> list[dict]:
    """Stop the reply in flight, including any audio. The transcript lands about 0.5 s after end of
    speech and audio about 1 s after, so this usually happens before the candidate hears anything."""
    out = _stop_reply(state)
    if state.assistant_audio:
        out.append({"do": "clear_audio"})
    state.current = state.reply_item = None
    return out


def _set_mode(state: TurnState, mode: str) -> list[dict]:
    if state.mode == mode:
        return []
    state.mode = mode
    return [{"do": "mode", "mode": mode}]


def _listen(state: TurnState, wait_ms: int) -> list[dict]:
    _cancel(state, "nudge")
    return _set_mode(state, "listening") + [_timer(state, "think", wait_ms)]


def _voiced_ms(state: TurnState, end: int | None) -> int | None:
    start = state.speech_start_ms
    if end is None or start is None:
        return None
    return max(0, (end - state.silence_ms) - (start + state.prefix_padding_ms))


# --- event handlers ----------------------------------------------------------

def _start(state: TurnState, ev: dict) -> list[dict]:
    if state.stage != "waiting":
        return []
    state.stage = "intro"
    return [{"do": "stage", "stage": "intro"}] + _reply(state, "greeting", GREETING_PROMPT)


def _case_started(state: TurnState, ev: dict) -> list[dict]:
    """The interviewer judged the candidate ready and called start_case."""
    if state.stage == "case":
        return []
    state.stage = "case"
    return [{"do": "stage", "stage": "case"}]


def _tool_wait(state: TurnState, ev: dict) -> list[dict]:
    """The interviewer heard a request for time and called wait_for_candidate."""
    return _listen(state, ev.get("wait_ms") or HOLD_MS)


def _say(state: TurnState, ev: dict) -> list[dict]:
    """A line the server needs (a tool's follow-up, the guard's hand-back): same slot, same rules."""
    return _reply(state, ev["reason"], ev.get("prompt"))


def _typed(state: TurnState, ev: dict) -> list[dict]:
    state.nudges = 0
    return _reply(state, "typed")


def _speech_started(state: TurnState, ev: dict) -> list[dict]:
    state.speech_start_ms = ev.get("audio_start_ms")
    state.candidate_speaking = True
    _cancel(state, "nudge")
    if state.assistant_audio:
        # Over her speech. OpenAI has already cleared her audio; stop the rest of the reply too, and
        # decide when they stop whether it was a cough (resume her) or a turn (reply to it).
        state.cut = {"heard": True}
        return _abort_reply(state)
    if state.reply_requested or state.response_active:
        # They kept talking before hearing any of the reply: the pause was not the end of their turn.
        state.cut = {**(state.current or {}), "heard": False}
        out = [{"do": "metric", "name": "premature_reply_cancelled"}] + _stop_reply(state)
        state.current = state.reply_item = None
        return out
    return []


def _speech_stopped(state: TurnState, ev: dict) -> list[dict]:
    state.candidate_speaking = False
    state.last_duration_ms = _voiced_ms(state, ev.get("audio_end_ms"))
    cut, state.cut = state.cut, None
    if cut is None:
        return []  # the commit decides
    if state.last_duration_ms is not None and state.last_duration_ms < BLIP_MS:
        state.blip_next_commit = True  # a cough or "mm-hmm" stopped her: drop it and let her carry on
        out = [{"do": "metric", "name": "blip", "voiced_ms": state.last_duration_ms}]
        if cut["heard"]:
            return out + _reply(state, "resume", RESUME_PROMPT)
        if cut.get("reason") and not state.want:  # re-ask for the reply it cancelled; its prompt is in place
            return out + _reply(state, cut["reason"], item=cut.get("item"))
        return out + _pump(state)
    return [{"do": "metric", "name": "barge_in" if cut["heard"] else "turn_continued"}]


def _committed(state: TurnState, ev: dict) -> list[dict]:
    item = ev["item_id"]
    if state.blip_next_commit:
        state.blip_next_commit = False
        return [{"do": "delete_item", "item_id": item, "reason": "blip"}]
    state.nudges = 0  # they spoke: the check-in ladder starts over
    if state.mode == "listening":
        state.awaiting[item] = "listening"
        return _pump(state)
    if state.last_duration_ms is not None and state.last_duration_ms < SHORT_UTTERANCE_MS:
        state.awaiting[item] = "short"
        return _pump(state)
    # Replaces anything still waiting (say, the case brief's follow-up): this reply sees all of it.
    return _reply(state, "end_of_speech", item=item)


def _transcript(state: TurnState, ev: dict) -> list[dict]:
    item, text = ev["item_id"], (ev.get("text") or "").strip()
    why = state.awaiting.pop(item, None)
    if why == "listening":
        return [{"do": "analyze", "item_id": item, "text": text}]

    out: list[dict] = []
    if why == "short":
        if not SPEECH_RE.search(text):
            return [{"do": "delete_item", "item_id": item, "reason": "noise"}]
        out += _reply(state, "short_answer")
    elif state.reply_item == item:  # the reply to this utterance is already on its way
        if not SPEECH_RE.search(text):  # inaudible: never let the model guess what they said
            return (_abort_reply(state) + [{"do": "delete_item", "item_id": item, "reason": "inaudible"}]
                    + _reply(state, "repeat", REPEAT_PROMPT))
        if state.stage == "case" and FILLER_RE.match(text):  # "hmm", "um": they are thinking
            return (_abort_reply(state) + [{"do": "delete_item", "item_id": item, "reason": "filler"},
                                           _timer(state, "nudge", NUDGE_MS[0])])

    # Backup for the wait_for_candidate tool: phrase rules on the transcript.
    wait = requested_wait_ms(text)
    if wait and state.mode == "conversation":
        out += _listen(state, wait)
    return out


def _analysis(state: TurnState, ev: dict) -> list[dict]:
    """The analyzer's verdict on an utterance heard in listening mode."""
    if state.mode != "listening":
        return []
    intent = ev.get("intent")
    if intent == "hand_back":
        _cancel(state, "think")
        return _set_mode(state, "conversation") + _reply(state, "hand_back")
    if intent == "wants_time":
        return [_timer(state, "think", ev.get("wait_ms") or THINK_MS)] + _reply(state, "wait_ack", WAIT_ACK_PROMPT)
    return [{"do": "metric", "name": "listening_hold"}]


def _response_created(state: TurnState, ev: dict) -> list[dict]:
    state.reply_requested, state.response_active = False, True
    _cancel(state, "watchdog")
    if state.cancel_on_create or state.candidate_speaking:  # wanted gone before it existed
        state.cancel_on_create, state.cancelling = False, True
        return [{"do": "cancel_response"}]
    return []


def _response_done(state: TurnState, ev: dict) -> list[dict]:
    state.response_active = state.cancelling = False
    state.current = None
    return _pump(state)  # a reply waiting for the slot goes now


def _audio_started(state: TurnState, ev: dict) -> list[dict]:
    state.assistant_audio = True
    _cancel(state, "nudge")
    if state.candidate_speaking:  # safety net: her audio began while they were talking
        state.cut = {"heard": True}
        return [{"do": "metric", "name": "talked_over_candidate"}] + _abort_reply(state)
    return []


def _audio_stopped(state: TurnState, ev: dict) -> list[dict]:
    state.assistant_audio = False
    if state.mode != "conversation" or state.stage == "waiting" or state.want or _busy(state):
        return []
    if state.nudges < len(NUDGE_MS):
        return [_timer(state, "nudge", NUDGE_MS[state.nudges])]
    return []


def _on_timer(state: TurnState, kind: str) -> list[dict]:
    if kind == "watchdog":  # a requested reply never started (lost or rejected): ask again
        if not state.reply_requested or state.response_active:
            return []
        state.reply_requested = False
        return [{"do": "metric", "name": "watchdog_fired"}] + _reply(state, "watchdog", item=state.reply_item)
    if kind == "think":
        if state.mode != "listening":
            return []
        if _busy(state) or state.candidate_speaking:
            return [_timer(state, "think", BUSY_RETRY_MS)]
        return _set_mode(state, "conversation") + _reply(state, "think_checkin", CHECKIN_PROMPT)
    if kind == "nudge":
        if (state.mode != "conversation" or _busy(state) or state.candidate_speaking
                or state.nudges >= len(NUDGE_PROMPTS)):
            return []
        prompt = NUDGE_PROMPTS[state.nudges]
        state.nudges += 1
        return _reply(state, "nudge", prompt)
    return []


_HANDLERS = {
    "start": _start,
    "case_started": _case_started,
    "tool_wait": _tool_wait,
    "say": _say,
    "typed": _typed,
    "speech_started": _speech_started,
    "speech_stopped": _speech_stopped,
    "committed": _committed,
    "transcript": _transcript,
    "analysis": _analysis,
    "response_created": _response_created,
    "response_done": _response_done,
    "audio_started": _audio_started,
    "audio_stopped": _audio_stopped,
}
