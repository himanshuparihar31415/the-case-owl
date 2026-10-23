"""Tests for the live guard and the fact gate's policy (carried over from the phase 0 spike)."""
import unittest

from app.runtime import facts
from app.runtime.guard import check
from app.store import case_files

CASE = facts.Case.from_doc(next(d for d in case_files() if d["caseId"] == "coffee"))


def guard(reply, said="", released=()):
    return check(reply, said, CASE, set(released))


class SelfAnswer(unittest.TestCase):
    def test_the_reply_from_the_second_voice_test_is_caught(self):
        reply = "Since revenue and visits are flat, I'd start by comparing major cost buckets over the two years."
        self.assertIsNotNone(guard(reply))

    def test_proposals_and_conclusions_are_caught(self):
        for reply in ("You might want to look at costs first.",
                      "One way to approach this is to split revenue and cost.",
                      "The key driver is probably the supplier.",
                      "Let's start by looking at the cost side."):
            self.assertEqual(guard(reply)["kind"], "self_answer", reply)

    def test_ordinary_interviewer_lines_pass(self):
        for reply in ("How would you like to approach it?",
                      "Where would you like to start?",
                      "That's a reasonable structure. What would you look at first?",
                      "Sure, take your time.",
                      "Sorry, I didn't catch that. Could you say it again?",
                      "You might start anywhere that feels natural to you.",  # evals: an invitation, not a proposal
                      "You could begin wherever you like."):
            self.assertIsNone(guard(reply), reply)


class GatedFacts(unittest.TestCase):
    def test_a_facts_telltale_words_before_it_is_released(self):
        # 22 Oct voice test: a fixed-vs-variable question got beans +35%, the supplier, labour and rent.
        said = "Is there an increase in fixed or variable cost?"
        hit = guard("Coffee bean costs rose 35 percent after a supplier change.", said, released={"cost_split"})
        self.assertEqual(hit["kind"], "fed_fact")

    def test_released_facts_may_be_said(self):
        self.assertIsNone(guard("Coffee bean costs rose 35 percent over the two years.",
                                "What happened to bean costs?", released={"beans"}))

    def test_the_candidates_own_words_may_be_echoed(self):
        self.assertIsNone(guard("You mentioned the supplier. What makes you think so?", "Is it the supplier?"))

    def test_a_topic_is_not_a_fact(self):  # naming a topic reveals nothing; its content ("flat") is the fact
        self.assertIsNone(guard("What would you want to know about customer visits?", "What about volume?"))


class FedDirection(unittest.TestCase):
    def test_naming_the_cost_branch_before_the_candidate_does(self):  # seen in evals when the candidate was stuck
        hit = guard("Start with a simple breakdown of revenue versus costs.", "I'm not sure where to start.")
        self.assertEqual(hit["kind"], "fed_direction")

    def test_costs_are_fine_once_the_candidate_raised_them(self):
        self.assertIsNone(guard("Sure, which costs would you look at?", "I'd split profit into revenue and costs."))

    def test_naming_ingredients_before_they_reach_them(self):
        hit = guard("Have you thought about ingredients?", "Costs went up, so I'd look at costs.")
        self.assertEqual(hit["kind"], "fed_direction")

    def test_a_released_fact_opens_its_words(self):
        self.assertIsNone(guard("Ingredients are mostly coffee beans.", "What are the main costs?",
                                released={"cost_lines"}))


class ReleasePolicy(unittest.TestCase):
    def test_a_match_is_released_and_remembered(self):
        released = set()
        out = facts.release(CASE, {"status": "match", "fact_ids": ["cost_split"]}, released)
        self.assertEqual(out["status"], "answer")
        self.assertEqual(out["facts"], [CASE.facts["cost_split"].answer])
        self.assertEqual(released, {"cost_split"})

    def test_a_cause_waits_for_what_it_explains(self):
        released = set()
        out = facts.release(CASE, {"status": "match", "fact_ids": ["beans_why"]}, released)
        self.assertEqual((out["status"], out["facts"], released), ("declined", [], set()))
        released.add("beans")
        self.assertEqual(facts.release(CASE, {"status": "match", "fact_ids": ["beans_why"]}, released)["status"],
                         "answer")

    def test_at_most_two_facts_and_unknown_ids_ignored(self):
        out = facts.release(CASE, {"status": "match", "fact_ids": ["rent", "made_up", "labour", "overheads"]}, set())
        self.assertEqual(out["ids"], ["rent"])
        out = facts.release(CASE, {"status": "match", "fact_ids": ["made_up"]}, set())
        self.assertEqual(out["status"], "unknown")

    def test_two_facts_only_side_by_side(self):
        # Evals: "which cost categories rose, fixed or variable?" matched the split and the cost lines; the
        # cost lines ("ingredients, mostly coffee beans") pointed at the answer.
        out = facts.release(CASE, {"status": "match", "fact_ids": ["cost_split", "cost_lines"]}, set())
        self.assertEqual(out["ids"], ["cost_split"])
        out = facts.release(CASE, {"status": "match", "fact_ids": ["labour", "rent"]}, set())
        self.assertEqual(out["ids"], ["labour", "rent"])

    def test_the_matcher_never_sees_answers(self):
        sheet = facts.sheet(CASE)
        for f in CASE.facts.values():
            self.assertNotIn(f.answer, sheet)


if __name__ == "__main__":
    unittest.main()
