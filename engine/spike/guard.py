"""Live check of the interviewer's words while she speaks: layer 3 of the plan's leak defence.

Transcript deltas reach the engine ahead of playback, because the model generates faster
than real time. A hit lets the engine cancel the reply and clear the queued audio, often
before the offending words are heard. It is a net, not a wall: prevention comes first
(facts behind a tool gate in phase 1, rules restated every turn).

`check(reply, candidate_said)` returns None or
{"kind": "self_answer" | "fed_fact" | "fed_direction", "term": ...}.
"""
from __future__ import annotations

import re

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

COST_TOPIC = re.compile(r"\b(costs?|expenses?|spend|cogs|margins?|supplier|beans?|inputs?|labou?r|wages?|rent)\b", re.I)
DEMAND_TOPIC = re.compile(r"\b(revenue|sales|prices?|pricing|customers?|visits?|volume|demand|ticket|traffic|"
                          r"footfall)\b", re.I)
# What the interviewer may say only once the candidate has raised its topic: case facts they must ask
# for, and branches of the case they must find themselves (naming "costs" first points them at the
# answer). Spike-specific (the coffee case); phase 1 derives these from the case's own tree.
GATES = [
    ("fed_fact", re.compile(r"\b(beans?|supplier|35 ?(percent|%)|labou?r|rent)\b", re.I), COST_TOPIC),
    ("fed_fact", re.compile(r"\b(visits?|ticket|footfall|traffic)\b", re.I), DEMAND_TOPIC),
    ("fed_direction", re.compile(r"\b(costs?|cost side|expenses?|margins?)\b", re.I), COST_TOPIC),
]


def check(reply: str, candidate_said: str) -> dict | None:
    match = SELF_ANSWER_RE.search(reply)
    if match:
        return {"kind": "self_answer", "term": match.group(0)}
    for kind, said, topic in GATES:
        hit = said.search(reply)
        if hit and not topic.search(candidate_said):
            return {"kind": kind, "term": hit.group(0)}
    return None
