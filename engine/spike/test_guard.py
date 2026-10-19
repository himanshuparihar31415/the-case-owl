"""Tests for the live guard. Run: python3 -m unittest engine/spike/test_guard.py"""
import unittest

from guard import check


class SelfAnswer(unittest.TestCase):
    def test_the_reply_from_the_second_voice_test_is_caught(self):
        reply = "Since revenue and visits are flat, I'd start by comparing major cost buckets over the two years."
        self.assertIsNotNone(check(reply, ""))

    def test_proposals_and_conclusions_are_caught(self):
        for reply in ("You might want to look at costs first.",
                      "One way to approach this is to split revenue and cost.",
                      "The key driver is probably the supplier.",
                      "Let's start by looking at the cost side."):
            self.assertEqual(check(reply, "")["kind"], "self_answer", reply)

    def test_ordinary_interviewer_lines_pass(self):
        for reply in ("How would you like to approach it?",
                      "Where would you like to start?",
                      "That's a reasonable structure. What would you look at first?",
                      "Sure, take your time.",
                      "Sorry, I didn't catch that. Could you say it again?",
                      "You might start anywhere that feels natural to you.",  # evals: an invitation, not a proposal
                      "You could begin wherever you like."):
            self.assertIsNone(check(reply, ""), reply)


class FedDirection(unittest.TestCase):
    def test_naming_the_cost_branch_before_the_candidate_does(self):  # seen in evals when the candidate was stuck
        hit = check("Start with a simple breakdown of revenue versus costs.", "I'm not sure where to start.")
        self.assertEqual(hit["kind"], "fed_direction")

    def test_costs_are_fine_once_the_candidate_raised_them(self):
        self.assertIsNone(check("Sure, which costs would you look at?", "I'd split profit into revenue and costs."))


class GatedFacts(unittest.TestCase):
    def test_fact_before_its_topic_is_raised(self):
        self.assertEqual(check("Customer visits have been flat.", "I'd like to understand the business first.")["kind"],
                         "fed_fact")
        self.assertIsNone(check("Customer visits have been flat.", "I'd split profit into revenue and costs."))

    def test_cost_fact_only_after_costs_come_up(self):
        self.assertEqual(check("Bean costs rose 35 percent.", "Let me look at revenue first.")["kind"], "fed_fact")
        self.assertIsNone(check("Bean costs rose 35 percent.", "What happened to costs?"))

    def test_visit_fact_after_demand_comes_up(self):
        self.assertIsNone(check("Visits are flat.", "Has customer volume changed?"))


if __name__ == "__main__":
    unittest.main()
