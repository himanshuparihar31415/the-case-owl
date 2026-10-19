"""Scenario tests for the turn-taking rules. Run: python3 -m unittest engine/spike/test_turns.py"""
import unittest

import turns
from turns import TurnState, handle, requested_wait_ms


def kinds(effects):
    return [e["do"] for e in effects]


def fire(state, effects, kind):
    """Fire the timer of `kind` that `effects` scheduled, as the server would."""
    timer = next(e for e in effects if e["do"] == "set_timer" and e["kind"] == kind)
    return handle(state, {"type": "timer", "kind": kind, "gen": timer["gen"]})


def utterance(state, item, start, end):
    """Candidate speaks from `start` to `end` ms, then the server commits `item`."""
    out = handle(state, {"type": "speech_started", "audio_start_ms": start})
    out += handle(state, {"type": "speech_stopped", "audio_end_ms": end})
    out += handle(state, {"type": "committed", "item_id": item})
    return out


def interviewer_talking(state):
    handle(state, {"type": "response_created"})
    handle(state, {"type": "audio_started"})


def interviewer_done(state):
    handle(state, {"type": "response_done"})
    return handle(state, {"type": "audio_stopped"})


def in_case():
    return TurnState(stage="case")


class Opening(unittest.TestCase):
    def test_start_greets_without_the_case(self):
        s = TurnState()
        out = handle(s, {"type": "start"})
        self.assertEqual(s.stage, "intro")
        greet = next(e for e in out if e["do"] == "create_response")
        self.assertEqual((greet["reason"], greet["prompt"]), ("greeting", turns.GREETING_PROMPT))
        self.assertEqual(handle(s, {"type": "start"}), [])  # only once

    def test_small_talk_has_no_turn_limit(self):
        # Judgment, not a counter: the engine never moves to the case on its own.
        s = TurnState()
        handle(s, {"type": "start"})
        interviewer_talking(s)
        interviewer_done(s)
        for n in range(6):
            out = utterance(s, f"i{n}", n * 5000, n * 5000 + 1500)
            self.assertEqual(out[0], {"do": "create_response", "reason": "end_of_speech"})
            interviewer_talking(s)
            interviewer_done(s)
        self.assertEqual(s.stage, "intro")

    def test_case_starts_when_the_interviewer_calls_start_case(self):
        s = TurnState()
        handle(s, {"type": "start"})
        self.assertEqual(handle(s, {"type": "case_started"}), [{"do": "stage", "stage": "case"}])
        self.assertEqual(s.stage, "case")
        self.assertEqual(handle(s, {"type": "case_started"}), [])  # a second call changes nothing


class Interruptions(unittest.TestCase):
    def test_heard_portion_of_the_case_cut_off_after_9_6_seconds(self):
        # Third voice test: the candidate cut in 9.6 s into the case presentation.
        text = ("Let's move on to the case. A regional coffee chain's operating profit fell from 6 million to 4.5 "
                "million dollars over two years, while revenue stayed around 30 million. They want to know why "
                "profit fell and what to do about it. How would you like to approach it?")
        heard, rest = turns.heard_portion(text, 9600)
        self.assertTrue(heard.startswith("Let's move on to the case."))
        self.assertTrue(rest.endswith("How would you like to approach it?"))
        self.assertEqual(f"{heard} {rest}", text)

    def test_heard_portion_edges(self):
        self.assertEqual(turns.heard_portion("Short reply.", None), ("", "Short reply."))
        self.assertEqual(turns.heard_portion("Short reply.", 60_000), ("Short reply.", ""))


class InterviewerTools(unittest.TestCase):
    def test_wait_for_candidate_enters_listening_for_that_long(self):
        s = in_case()
        out = handle(s, {"type": "tool_wait", "wait_ms": turns.wait_ms_for(15)})
        self.assertEqual(s.mode, "listening")
        self.assertEqual(out[-1]["ms"], 18_000)

    def test_phrase_backup_does_not_double_up_after_the_tool(self):
        s = in_case()
        utterance(s, "i1", 0, 2000)
        handle(s, {"type": "tool_wait", "wait_ms": 18_000})
        out = handle(s, {"type": "transcript", "item_id": "i1", "text": "Just wait for 15 seconds."})
        self.assertEqual(out, [])  # already listening: the backup stays quiet

    def test_wait_seconds_from_the_tool(self):
        self.assertEqual(turns.wait_ms_for(60), 63_000)
        self.assertEqual(turns.wait_ms_for(None), turns.HOLD_MS)  # "give me a moment": no number given
        self.assertEqual(turns.wait_ms_for(3600), turns.MAX_WAIT_MS)


class ConversationMode(unittest.TestCase):
    def test_end_of_speech_replies_at_once_with_watchdog(self):
        s = in_case()
        out = utterance(s, "i1", 0, 2400)
        self.assertEqual(kinds(out), ["create_response", "set_timer"])
        self.assertEqual(out[0]["reason"], "end_of_speech")

    def test_short_yes_waits_for_transcript_then_replies(self):
        s = in_case()
        self.assertEqual(utterance(s, "i1", 0, 250), [])
        out = handle(s, {"type": "transcript", "item_id": "i1", "text": "Yes."})
        self.assertEqual(out[0], {"do": "create_response", "reason": "short_answer"})

    def test_short_noise_is_deleted_without_reply(self):
        s = in_case()
        utterance(s, "i1", 0, 180)
        out = handle(s, {"type": "transcript", "item_id": "i1", "text": " "})
        self.assertEqual(out, [{"do": "delete_item", "item_id": "i1", "reason": "noise"}])

    def test_missing_vad_timestamps_fall_back_to_immediate_reply(self):
        s = in_case()
        handle(s, {"type": "speech_started"})
        handle(s, {"type": "speech_stopped"})
        self.assertEqual(handle(s, {"type": "committed", "item_id": "i1"})[0]["reason"], "end_of_speech")


class UnclearTurns(unittest.TestCase):
    def reply_in_flight(self, text, stage="case"):
        s = TurnState(stage=stage)
        utterance(s, "i1", 0, 2000)  # the reply fires at end of speech, before the transcript
        handle(s, {"type": "response_created"})
        return s, handle(s, {"type": "transcript", "item_id": "i1", "text": text})

    def test_inaudible_turn_cancels_the_reply_and_asks_to_repeat(self):
        # Second voice test: an empty transcript got a reply in which Maya answered her own question.
        s, out = self.reply_in_flight("")
        self.assertEqual(kinds(out), ["cancel_response", "delete_item"])
        ask = handle(s, {"type": "response_done"})  # the request to repeat waits for the slot
        self.assertEqual(kinds(ask), ["create_response", "set_timer"])
        self.assertEqual(ask[0]["prompt"], turns.REPEAT_PROMPT)

    def test_filler_cancels_the_reply_and_waits(self):
        s, out = self.reply_in_flight("Hmm.")
        self.assertEqual(kinds(out), ["cancel_response", "delete_item", "set_timer"])
        self.assertEqual(out[2]["kind"], "nudge")

    def test_filler_during_small_talk_still_gets_a_reply(self):
        self.assertEqual(self.reply_in_flight("Hmm.", stage="intro")[1], [])

    def test_a_real_answer_is_left_alone(self):
        self.assertEqual(self.reply_in_flight("I'd split profit into revenue and costs.")[1], [])


class RequestsForTime(unittest.TestCase):
    def test_named_durations(self):
        self.assertEqual(requested_wait_ms("Just wait for 15 seconds. Okay"), 18_000)
        self.assertEqual(requested_wait_ms("Can you give me a minute to structure?"), turns.THINK_MS)
        self.assertEqual(requested_wait_ms("Give me two minutes"), 123_000)
        self.assertEqual(requested_wait_ms("hold on a second"), turns.HOLD_MS)
        self.assertEqual(requested_wait_ms("Stop."), turns.HOLD_MS)
        self.assertEqual(requested_wait_ms("Let me think."), turns.THINK_MS)

    def test_case_content_is_not_a_request(self):
        for text in ("The chain should stop opening new cafes.",
                     "Deliveries take 30 minutes per store.",
                     "Profit fell over the last two years.",
                     "Stop investing in marketing until costs recover."):
            self.assertIsNone(requested_wait_ms(text), text)

    def test_wait_request_enters_listening_with_that_duration(self):
        s = in_case()
        utterance(s, "i1", 0, 2000)  # the reply ("Sure, take your time") fires at end of speech
        out = handle(s, {"type": "transcript", "item_id": "i1", "text": "Just wait for 15 seconds. Okay"})
        self.assertEqual(s.mode, "listening")
        timer = next(e for e in out if e["do"] == "set_timer")
        self.assertEqual((timer["kind"], timer["ms"]), ("think", 18_000))


class ListeningMode(unittest.TestCase):
    def listening(self):
        s = in_case()
        utterance(s, "i1", 0, 1500)
        handle(s, {"type": "response_created"})
        out = handle(s, {"type": "transcript", "item_id": "i1", "text": "Can you give me a minute?"})
        interviewer_done(s)
        return s, out

    def test_utterances_go_to_the_analyzer_without_a_reply(self):
        s, _ = self.listening()
        self.assertEqual(utterance(s, "i2", 9000, 12000), [])
        out = handle(s, {"type": "transcript", "item_id": "i2", "text": "hmm revenue is price times volume"})
        self.assertEqual(out, [{"do": "analyze", "item_id": "i2", "text": "hmm revenue is price times volume"}])

    def test_still_thinking_stays_silent(self):
        s, _ = self.listening()
        out = handle(s, {"type": "analysis", "item_id": "i2", "intent": "still_thinking"})
        self.assertEqual(out, [{"do": "metric", "name": "listening_hold"}])

    def test_hand_back_replies_and_returns_to_conversation(self):
        s, _ = self.listening()
        out = handle(s, {"type": "analysis", "item_id": "i3", "intent": "hand_back"})
        self.assertEqual(s.mode, "conversation")
        self.assertIn({"do": "create_response", "reason": "hand_back"}, out)

    def test_more_time_restarts_the_clock_with_a_short_acknowledgement(self):
        s, first = self.listening()
        out = handle(s, {"type": "analysis", "item_id": "i4", "intent": "wants_time", "wait_ms": 33_000})
        self.assertEqual(out[0]["ms"], 33_000)
        ack = next(e for e in out if e["do"] == "create_response")
        self.assertEqual(ack["prompt"], turns.WAIT_ACK_PROMPT)
        self.assertEqual(fire(s, first, "think"), [])  # the old timer is stale

    def test_think_timer_checks_in_about_the_person(self):
        s, out = self.listening()
        out = fire(s, out, "think")
        self.assertEqual(s.mode, "conversation")
        checkin = next(e for e in out if e["do"] == "create_response")
        self.assertEqual(checkin["prompt"], turns.CHECKIN_PROMPT)

    def test_check_in_waits_while_the_interviewer_talks(self):
        s, out = self.listening()
        interviewer_talking(s)
        retry = fire(s, out, "think")
        self.assertEqual((kinds(retry), retry[0]["ms"]), (["set_timer"], turns.BUSY_RETRY_MS))

    def test_no_nudges_while_listening(self):
        s, _ = self.listening()
        interviewer_talking(s)
        self.assertEqual(interviewer_done(s), [])

    def test_fallback_classifier(self):
        self.assertEqual(turns.classify_fallback("Okay, so my framework has three parts")["intent"], "hand_back")
        self.assertEqual(turns.classify_fallback("hmm, costs, maybe")["intent"], "still_thinking")
        self.assertEqual(turns.classify_fallback("One more minute please")["intent"], "wants_time")


def server_vad():
    """VAD timestamps as OpenAI sends them: start includes 400 ms padding, end the 1,000 ms silence window."""
    return TurnState(stage="case", prefix_padding_ms=400, silence_ms=1000)


class InterruptionsWhileInterviewerTalks(unittest.TestCase):
    def test_a_cough_stops_her_and_she_carries_on(self):
        # 19 Oct voice test: a ~300 ms noise 7 s into the case. OpenAI cleared her audio at once; the
        # engine took the empty transcript as unclear speech and asked "Sorry, I didn't catch that".
        s = server_vad()
        interviewer_talking(s)
        self.assertEqual(kinds(handle(s, {"type": "speech_started", "audio_start_ms": 100112})),
                         ["cancel_response", "clear_audio"])
        handle(s, {"type": "response_done"})
        handle(s, {"type": "audio_stopped"})
        out = handle(s, {"type": "speech_stopped", "audio_end_ms": 101824})  # voiced: 312 ms
        self.assertEqual(out[0], {"do": "metric", "name": "blip", "voiced_ms": 312})
        self.assertEqual((out[1]["reason"], out[1]["prompt"]), ("resume", turns.RESUME_PROMPT))
        self.assertEqual(handle(s, {"type": "committed", "item_id": "cough"}),
                         [{"do": "delete_item", "item_id": "cough", "reason": "blip"}])

    def test_sustained_speech_interrupts_then_gets_a_reply(self):
        s = server_vad()
        interviewer_talking(s)
        handle(s, {"type": "speech_started", "audio_start_ms": 5000})
        handle(s, {"type": "response_done"})
        handle(s, {"type": "audio_stopped"})
        self.assertEqual(handle(s, {"type": "speech_stopped", "audio_end_ms": 9000}),
                         [{"do": "metric", "name": "barge_in"}])
        self.assertEqual(handle(s, {"type": "committed", "item_id": "i2"})[0]["reason"], "end_of_speech")

    def test_her_audio_starting_over_the_candidate_is_stopped(self):
        s = in_case()
        handle(s, {"type": "speech_started", "audio_start_ms": 0})
        handle(s, {"type": "response_created"})  # a response created elsewhere is cancelled at once
        out = handle(s, {"type": "audio_started"})
        self.assertEqual(kinds(out), ["metric", "clear_audio"])


class PausesAndOverlap(unittest.TestCase):
    """19 Oct voice test: "I'm good, doing good also. So…" (1.2 s pause) "…how about you?". The reply to
    the first half was requested 150 ms before they went on; the engine did not count itself busy until
    OpenAI confirmed it, so nothing stopped it. It called start_case, the case played over them, and
    the reply to "how about you?" was rejected: "Conversation already has an active response"."""

    def test_continuing_before_the_reply_exists_cancels_it_on_creation(self):
        s = server_vad()
        out = utterance(s, "i1", 6352, 11936)
        self.assertEqual(out[0]["reason"], "end_of_speech")
        self.assertEqual(handle(s, {"type": "speech_started", "audio_start_ms": 11664}),
                         [{"do": "metric", "name": "premature_reply_cancelled"}])
        self.assertEqual(handle(s, {"type": "response_created"}), [{"do": "cancel_response"}])
        self.assertEqual(handle(s, {"type": "response_done"}), [])  # nothing replies while they talk
        handle(s, {"type": "speech_stopped", "audio_end_ms": 14336})
        out = handle(s, {"type": "committed", "item_id": "i2"})
        self.assertEqual(out[0], {"do": "create_response", "reason": "end_of_speech"})  # one reply, both halves

    def test_continuing_while_the_reply_is_generating_cancels_it(self):
        s = server_vad()
        utterance(s, "i1", 0, 3000)
        handle(s, {"type": "response_created"})
        out = handle(s, {"type": "speech_started", "audio_start_ms": 2800})
        self.assertEqual(kinds(out), ["metric", "cancel_response"])

    def test_a_cough_in_the_pause_brings_the_reply_back(self):
        s = server_vad()
        utterance(s, "i1", 0, 3000)
        handle(s, {"type": "response_created"})
        handle(s, {"type": "speech_started", "audio_start_ms": 2800})
        handle(s, {"type": "response_done"})
        out = handle(s, {"type": "speech_stopped", "audio_end_ms": 4400})  # voiced: 200 ms
        self.assertEqual(kinds(out), ["metric", "create_response", "set_timer"])
        self.assertEqual(out[1], {"do": "create_response", "reason": "end_of_speech"})
        self.assertEqual(s.reply_item, "i1")

    def test_a_tool_follow_up_waits_and_is_folded_into_their_turn(self):
        s = server_vad()
        handle(s, {"type": "speech_started", "audio_start_ms": 0})
        self.assertEqual(handle(s, {"type": "say", "reason": "case_brief"}), [])  # not over the candidate
        handle(s, {"type": "speech_stopped", "audio_end_ms": 3000})
        out = handle(s, {"type": "committed", "item_id": "i2"})
        self.assertEqual([e.get("reason") for e in out if e["do"] == "create_response"], ["end_of_speech"])

    def test_never_two_responses_at_once(self):
        s = server_vad()
        handle(s, {"type": "say", "reason": "case_brief"})
        handle(s, {"type": "response_created"})  # generating, not yet heard
        out = utterance(s, "i2", 0, 3000)  # a turn commits meanwhile
        self.assertNotIn("create_response", kinds(out))
        self.assertIn("cancel_response", kinds(out))
        self.assertEqual(handle(s, {"type": "response_done"})[0]["reason"], "end_of_speech")

    def test_a_reply_being_heard_finishes_before_the_next(self):
        s = in_case()
        interviewer_talking(s)
        self.assertEqual(handle(s, {"type": "say", "reason": "tool_ack"}), [])
        self.assertEqual(handle(s, {"type": "response_done"})[0]["reason"], "tool_ack")

    def test_voiced_time_excludes_padding_and_silence(self):
        s = server_vad()
        handle(s, {"type": "speech_started", "audio_start_ms": 100112})
        handle(s, {"type": "speech_stopped", "audio_end_ms": 101824})
        self.assertEqual(s.last_duration_ms, 312)


class Nudges(unittest.TestCase):
    def test_two_step_ladder_then_silence(self):
        s = in_case()
        out = interviewer_done(s)
        self.assertEqual(out[0]["ms"], turns.NUDGE_MS[0])
        first = fire(s, out, "nudge")
        self.assertEqual(first[0]["prompt"], turns.NUDGE_PROMPTS[0])
        interviewer_talking(s)
        out = interviewer_done(s)
        self.assertEqual(out[0]["ms"], turns.NUDGE_MS[1])
        second = fire(s, out, "nudge")
        self.assertEqual(second[0]["prompt"], turns.NUDGE_PROMPTS[1])
        interviewer_talking(s)
        self.assertEqual(interviewer_done(s), [])  # no third nudge

    def test_ladder_resets_when_the_candidate_speaks(self):
        s = in_case()
        fire(s, interviewer_done(s), "nudge")
        interviewer_talking(s)
        interviewer_done(s)
        utterance(s, "i1", 0, 2000)
        interviewer_talking(s)
        self.assertEqual(interviewer_done(s)[0]["ms"], turns.NUDGE_MS[0])

    def test_speech_cancels_a_pending_nudge(self):
        s = in_case()
        out = interviewer_done(s)
        handle(s, {"type": "speech_started", "audio_start_ms": 100})
        self.assertEqual(fire(s, out, "nudge"), [])

    def test_no_nudge_before_the_interview_starts(self):
        self.assertEqual(interviewer_done(TurnState()), [])


class Watchdog(unittest.TestCase):
    def test_fires_when_no_response_starts(self):
        s = in_case()
        self.assertEqual(kinds(fire(s, utterance(s, "i1", 0, 2000), "watchdog")),
                         ["metric", "create_response", "set_timer"])

    def test_cancelled_by_response_created(self):
        s = in_case()
        out = utterance(s, "i1", 0, 2000)
        handle(s, {"type": "response_created"})
        self.assertEqual(fire(s, out, "watchdog"), [])


if __name__ == "__main__":
    unittest.main()
