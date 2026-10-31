# Interviewer failure mechanisms found so far

The `interview-analyst` agent's shared memory. One entry per confirmed mechanism: date, symptom,
mechanism, evidence, fix. The full tables with event-log detail are in `engine/spike/README.md`
("Fifth iteration", "Sixth iteration" and later sections) and `engine/README.md`.

- **19 Oct, greeting said twice.** `start_case` was callable during the greeting; speech before a tool
  call is a "commentary" preamble and WebRTC plays every generated word. Fix: speech-only replies use
  `tool_choice: none`; tools are called silently and the engine asks for one spoken follow-up. 0
  preambles in 80 runs. Evidence: spike README, fifth iteration.
- **19 Oct, history held words nobody heard.** Replies cancelled before audio stayed in the
  conversation, so she referred to things never said. Fix: settle deletes them; tool calls run only when
  their reply completed; the page retracts the bubble. Invariant: history equals what was heard.
- **19 Oct, steering one turn late.** The steering note was written after the reply it was meant to
  steer. Fix: write it before requesting the reply.
- **19 Oct, two replies at once** ("Conversation already has an active response"). A tool follow-up
  started outside the turn rules. Fix: one reply slot for every reply (tool follow-ups, guard, typed
  turns); nothing starts while the candidate speaks. Evidence: spike README, sixth iteration.
- **19 Oct, a cough cut her off.** OpenAI clears her audio on any detected sound whatever
  `interrupt_response` says (known API issue). Fix: blips judged by voiced time, under 450 ms she
  resumes. Not solved: talking through a cough needs engine-owned voice detection (open decision).
- **22 to 23 Oct, wrong fact released.** The small matcher (`gpt-5.4-nano`) picked the parent fact or
  one already told. Fix: matcher `gpt-5.6-luna`, and it is told which facts were already given.
- **23 Oct, `gpt-realtime-2.1-mini` rejected.** Preambles came back, she hinted ("costs, operations…?"),
  and restarted the case after an interruption: 8 of 16 scenarios. Not a mechanism to fix; a model
  limit. Re-test when a new mini model ships.
