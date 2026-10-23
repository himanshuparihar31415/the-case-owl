"""Live check of the interviewer's words while she speaks: layer 3 of the plan's leak defence.

Transcript deltas reach the engine ahead of playback, because the model generates faster
than real time. A hit lets the engine cancel the reply and clear the queued audio, often
before the offending words are heard. It is a net, not a wall: prevention comes first
(she holds only the case statement; facts come one at a time through lookup_fact).

`check(reply, candidate_said, case, released)` returns None or
{"kind": "self_answer" | "fed_fact" | "fed_direction", "term": ...}. What counts as a fact or a
direction comes from the case data (facts' `terms`, the case's `leads`), not from code.
"""
from __future__ import annotations

import re

from .facts import Case, allowed_text, mentions

# An open invitation ("you might start anywhere") hands the floor back; it is not a proposal.
_OPEN = r"(?! (anywhere|wherever|whatever|however|where you|with (whatever|whichever|what(ever)? you)))"
# The interviewer proposing an approach, a driver or a conclusion instead of asking.
SELF_ANSWER_RE = re.compile(
    r"\b(i'?d (start|begin|look|focus|suggest|recommend|compare|break)|"
    r"i would (start|begin|look|focus|suggest|recommend|compare|break)|"
    r"let'?s start by|let'?s (look|focus) (at|on) (the )?(costs?|revenue|prices?|volume)|"
    r"my (approach|suggestion|guess|hypothesis) (is|would)|"
    r"one (way|approach) (to|would be|is)|"
    rf"you (could|might|should|may)( want to)? (start|begin|look|consider|compare|break|focus)\b{_OPEN}|"
    r"the (key|main|likely|real) (driver|reason|issue|culprit|problem) (is|was|seems)|"
    r"it'?s (probably|likely) (the|a|that|because))\b",
    re.I,
)


def check(reply: str, candidate_said: str, case: Case, released: set[str]) -> dict | None:
    match = SELF_ANSWER_RE.search(reply)
    if match:
        return {"kind": "self_answer", "term": match.group(0)}
    allowed = allowed_text(case, candidate_said, released)
    for fact in case.facts.values():  # a fact's telltale words, before it was released
        if fact.id in released:
            continue
        for term in fact.terms:
            if mentions(reply, term) and not mentions(allowed, term):
                return {"kind": "fed_fact", "term": term}
    for lead in case.leads:  # a branch named before the candidate reached it
        if any(mentions(candidate_said, t) for t in lead["until_candidate_says"]):
            continue
        for term in lead["says"]:
            if mentions(reply, term) and not mentions(allowed, term):
                return {"kind": "fed_direction", "term": term}
    return None
