import { CaseType, Industry } from '../models/Case.js';

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced',
  4: 'Expert',
};

const FRAMEWORK_BY_TYPE: Record<CaseType, string> = {
  profitability: 'Profit Tree (Revenue - Costs decomposition, then segment by product/geography/channel)',
  market_entry: '4 pillars: Market Attractiveness, Competitive Landscape, Company Fit, Entry Strategy',
  ma: 'Strategic rationale, Synergy quantification (cost + revenue), Integration risks, Deal valuation',
  growth: 'Growth levers: existing customers × existing products, new customers, new products, new markets',
  pricing: 'Value-based pricing, cost-plus, competitive benchmarking, willingness-to-pay analysis',
  operations: 'Process mapping, bottleneck identification, capacity analysis, root cause diagnosis',
};

export function CASE_GENERATION_PROMPT(type: CaseType, industry: Industry, difficulty: number): string {
  return `You are a McKinsey case interview designer. Create a realistic ${DIFFICULTY_LABELS[difficulty]} difficulty ${type} case for the ${industry} industry.

Return ONLY valid JSON matching this exact schema:
{
  "title": "string (concise, business-like case title)",
  "description": "string (1-2 sentences, what the interviewer tells the candidate upfront)",
  "scenario": "string (detailed 3-4 sentence context that the AI interviewer will use — include financials, market context, and the client's ask)",
  "keyDataPoints": [
    { "label": "string", "value": "string" }
  ],
  "questions": ["string", "string", "string", "string"]
}

Requirements:
- keyDataPoints: 4-6 items with realistic financial/operational metrics
- questions: 4 progressive interviewer questions that follow ${FRAMEWORK_BY_TYPE[type]}
- Difficulty ${difficulty}/4 should reflect complexity: ${DIFFICULTY_LABELS[difficulty]}
- Use realistic company names and numbers
- The scenario should feel like a real client situation`;
}

export function HINT_PROMPT(transcriptText: string): string {
  return `You are a senior McKinsey partner coaching a candidate during a case interview.
Based on the following recent exchange, provide ONE concise, actionable hint (2-3 sentences max) that nudges the candidate toward the right approach WITHOUT giving away the answer.

Recent transcript:
${transcriptText}

Give a hint that helps the candidate think more structurally or consider something they may have missed. Be coaching, not prescriptive.`;
}

export function SCORING_PROMPT(transcriptText: string, caseTitle: string, caseType: string): string {
  return `You are an expert McKinsey case interview evaluator. Analyze this case interview transcript and provide a detailed evaluation.

Case: "${caseTitle}" (${caseType})

Transcript:
${transcriptText}

Return ONLY valid JSON matching this exact schema:
{
  "overallScore": number (0-100),
  "overallGrade": "STRONG_PASS" | "PASS" | "BORDERLINE" | "FAIL",
  "competencies": {
    "structure": { "score": number (0-100), "flag": "string or null — one-line warning if score < 60" },
    "math": { "score": number (0-100), "flag": "string or null" },
    "businessJudgment": { "score": number (0-100), "flag": "string or null" },
    "communication": { "score": number (0-100), "flag": "string or null" },
    "creativity": { "score": number (0-100), "flag": "string or null" },
    "hypothesis": { "score": number (0-100), "flag": "string or null" }
  },
  "feedback": {
    "strengths": ["string", "string", "string"],
    "improvements": ["string", "string", "string"],
    "momentsOfExcellence": ["string", "string"],
    "missedOpportunities": ["string", "string"],
    "keyHypotheses": ["string", "string"]
  },
  "executiveSummary": "string (2 sentences: overall assessment + top recommendation)"
}

Scoring rubric:
- STRUCTURE (0-100): MECE framework usage, logical flow, prioritization
- MATH (0-100): Accuracy, clarity of calculations, estimation skill
- BUSINESS_JUDGMENT (0-100): Practical insights, real-world applicability
- COMMUNICATION (0-100): Clarity, confidence, conciseness, active listening
- CREATIVITY (0-100): Original insights beyond standard frameworks
- HYPOTHESIS (0-100): Hypothesis-first thinking, testing and updating hypotheses

Grade thresholds: STRONG_PASS ≥ 80, PASS 65-79, BORDERLINE 50-64, FAIL < 50`;
}

export interface EvaluationContext {
  timestampedTranscript: string;
  caseTitle: string;
  caseType: string;
  difficultyLabel: string;
  durationLabel: string;
  hintsUsed: number;
  // Deterministic metrics computed in code (the model must NOT invent these).
  fluencyMetrics: {
    wordsPerMinute: number;
    fillerWordTotal: number;
    fillerWords: Array<{ word: string; count: number }>;
    repeatedPhrases: number;
    conciseAnswerRate: number;
    longestResponseWords: number;
    avgWordsPerResponse: number;
    longPauses: number;
  };
}

export function EVALUATION_PROMPT(ctx: EvaluationContext): string {
  const fillerList = ctx.fluencyMetrics.fillerWords.length
    ? ctx.fluencyMetrics.fillerWords.map((f) => `"${f.word}" — ${f.count}`).join(', ')
    : 'none detected';

  return `You are a demanding, evidence-driven McKinsey case interview evaluator writing a post-interview report for the CANDIDATE. Your job is to be HONEST and SPECIFIC, not encouraging. Never inflate scores. Never use vague praise like "good communication" without quoting evidence. Every judgement must be backed by a timestamp from the transcript.

VOICE — write so the candidate actually wants to read this. Speak directly to them ("you"), in vivid, engaging, human prose — like a sharp mentor who just watched the interview, not a textbook. Use concrete imagery and name real moments from THIS transcript. BANNED: generic, interchangeable advice that could apply to any candidate (e.g. "work on your structure", "be more concise", "practise more cases", "improve your business judgment"). Every observation and recommendation must be so specific to what THIS candidate did that it would make no sense in anyone else's report. Quote their words, cite the timestamp, and tie advice to the exact moment it would have changed the outcome.

CASE: "${ctx.caseTitle}" (${ctx.caseType})
DIFFICULTY: ${ctx.difficultyLabel}
DURATION: ${ctx.durationLabel}
HINTS THE CANDIDATE REQUESTED: ${ctx.hintsUsed}

TIMESTAMPED TRANSCRIPT (each line is "[mm:ss] ROLE: text"; lines marked [HINT] are coaching hints the candidate received — treat heavy hint reliance as a negative signal):
${ctx.timestampedTranscript}

PRE-COMPUTED COMMUNICATION METRICS (these are measured from the transcript — USE them, do not contradict or re-estimate them):
- Approx words per minute: ${ctx.fluencyMetrics.wordsPerMinute}
- Filler words total: ${ctx.fluencyMetrics.fillerWordTotal} (${fillerList})
- Repeated phrases: ${ctx.fluencyMetrics.repeatedPhrases}
- Concise-answer rate: ${ctx.fluencyMetrics.conciseAnswerRate}%
- Longest response: ~${ctx.fluencyMetrics.longestResponseWords} words
- Average response length: ${ctx.fluencyMetrics.avgWordsPerResponse} words
- Long pauses (>3s before answering): ${ctx.fluencyMetrics.longPauses}

Return ONLY valid JSON matching this exact schema. All scores are on a 0–10 scale. Cite real timestamps that appear in the transcript ("mm:ss"). If the candidate barely engaged, score low (2–4) and say why.

{
  "overall": {
    "score": number,                          // 0-10, one decimal allowed
    "readiness": "Not ready" | "Needs practice" | "Interview ready" | "Strong candidate",
    "decision": "Strong Hire" | "Hire" | "Borderline" | "No Hire",
    "confidence": "High" | "Medium" | "Low",   // your confidence in this assessment given transcript length
    "summary": "string — 2-4 sentences, honest executive summary. Name concrete weaknesses.",
    "primaryStrengths": ["string", "string"],
    "criticalGaps": ["string", "string"],
    "hintDependencyNote": "string — one line on how reliant they were on hints"
  },
  "competencies": [
    // EXACTLY these 8 keys, in this order:
    // problemUnderstanding, structuring, quantitative, businessJudgment, hypothesis, communication, synthesis, executivePresence
    {
      "key": "problemUnderstanding",
      "label": "Problem Understanding",
      "score": number,                         // 0-10
      "assessment": "string — a DETAILED analysis of 4-6 sentences (NOT one line). Cover: (1) what the candidate actually did on this competency, quoting/paraphrasing a specific moment; (2) what was strong about it; (3) the specific weakness or gap, with evidence; (4) why this matters in a real interview and how it affected the score; (5) what a top-scoring candidate would have done differently. Be concrete — reference real timestamps and the candidate's actual words, not generic advice.",
      "evidence": [ { "timestamp": "mm:ss", "note": "what happened at this moment" } ]  // 1-3 items, at least 1
    }
    // ... 7 more
  ],
  "communication": {
    "grammar": {
      "score": number,                         // 0-10
      "summary": "string — what the recurring grammar issues were",
      "issues": [
        { "timestamp": "mm:ss", "statement": "candidate's actual words", "issue": "the grammar/clarity problem", "better": "a corrected version" }
      ]                                          // 2-5 real examples pulled from the transcript
    },
    "fluency": {
      "summary": "string — interpret the pre-computed metrics honestly",
      "observations": [ { "timestamp": "mm:ss", "note": "fluency observation (pause, repetition, or a strong fluent moment)" } ]  // 2-4
    },
    "vocabulary": {
      "assessment": "string — was business vocabulary precise or generic?",
      "weakExample": "string — a weak/generic phrase the candidate used",
      "betterExample": "string — a sharper, more specific rewrite"
    }
  },
  "transcript": [
    // The KEY candidate turns only (6-12 of them), as an evidence layer. Do NOT include every turn.
    {
      "timestamp": "mm:ss",
      "role": "candidate" | "interviewer",
      "text": "the turn text (may be trimmed to the relevant part)",
      "markers": [ { "type": "strength" | "issue", "note": "string" } ],
      "tags": ["Structuring", "HypothesisDrivenThinking", "Communication", "Quantitative", "BusinessJudgment", "Synthesis", "Grammar", "MissedOpportunity"]  // pick the relevant ones
    }
  ],
  "missedOpportunities": [
    {
      "timestamp": "mm:ss", "situation": "what was being discussed", "candidateResponse": "what they said/did",
      "missed": "what they missed", "better": "the stronger approach",
      "habitTag": "rush_structuring" | "invent_number" | "skip_validation" | "clarity" | "no_hypothesis" | "shallow_risk" | "weak_synthesis"
      // Categorise the underlying behaviour so it can be tracked across sessions:
      // rush_structuring = jumped to specifics before framing; invent_number = stated a figure/assumption with no basis;
      // skip_validation = didn't sanity-check/validate a number; clarity = unclear/fragmented communication;
      // no_hypothesis = answered without forming/testing a hypothesis; shallow_risk = named risks without sizing them;
      // weak_synthesis = recommendation/close lacked a clear decision + support.
    }
  ],                                             // 3-5
  "idealAnswers": [
    { "question": "a major question the interviewer asked", "candidateAnswer": "summary of what the candidate said", "assessment": "honest critique", "strongerAnswer": "a model answer" }
  ],                                             // 2-3 for the biggest questions
  "timeManagement": [
    { "stage": "Understanding the problem", "timeSpent": "m:ss", "recommended": "2-3 min", "assessment": "Too short" | "Appropriate" | "Too long" | "Insufficient depth" | "Too brief" | "Too limited" }
    // Estimate stage boundaries from the timestamps. Stages: Understanding the problem, Structuring, Analysis, Risk assessment, Final recommendation.
  ],
  "hintDependency": {
    "assessment": "string — what their hint usage reveals about their gaps",
    "independentRate": number                    // 0-100, your estimate of % of progress made without prompting
  },
  "doneWell": ["string", "string", "string"],    // concrete, with implicit or explicit timestamp references
  "needsImprovement": ["string", "string", "string"],
  "priorityPlan": [
    {
      "priority": "P0" | "P1" | "P2",
      "action": "string — a clear, specific headline anchored to what THIS candidate did (e.g. reference the actual moment), not a generic skill name. NOT 'Improve structure' — name the real failure.",
      "detail": "string — a DETAILED, engaging explanation of 4-6 sentences (NOT one line) written directly to the candidate ('you'): quote/paraphrase the EXACT moment in this interview (with a timestamp), explain what you did and why it cost points right there, paint what the strong version of that moment would have sounded like, and the payoff of fixing it. It must be impossible to copy-paste this into another candidate's report. No generic textbook advice.",
      "practiceMethod": "string — a concrete, specific drill in 2-3 sentences tied to THIS weakness: exactly what to practise, how to run the drill, and the observable signal that tells them they've fixed it. Not 'do more cases'."
    }
  ]                                              // 4-6, ordered by priority
}

Scoring guidance (0-10): 0-3 = poor/failed, 4-5 = below bar, 6-7 = borderline/acceptable, 8-9 = strong, 10 = exceptional. Decision mapping: Strong Hire ≥ 8, Hire 6.5–7.9, Borderline 5–6.4, No Hire < 5. If a strong answer only emerged AFTER hints, lower the relevant competency score and note it. Be the evaluator a candidate needs, not the one they want.`;
}

export interface ProgressInsightContext {
  sessionCount: number;
  weeksSpan: number;
  latestOverall: number;       // 0-10
  delta3: number;              // change over last 3 sessions, 0-10 scale
  trajectory: number[];        // overall scores 0-10, oldest -> newest
  competencyTrends: Array<{ skill: string; latest: number; trend: 'up' | 'flat' | 'down' }>;
  habits: Array<{ tag: string; label: string; count: number; total: number }>;
  bestCaseType: string | null;
  untestedCaseTypes: string[];
}

export function PROGRESS_INSIGHT_PROMPT(ctx: ProgressInsightContext): string {
  return `You are a head case-interview coach reviewing a candidate's progress ACROSS many practice sessions (not a single one). Write a sharp, motivating-but-honest narrative that helps them knock their next real interview. Speak directly to the candidate ("you"). Be specific and concrete; avoid generic praise.

DATA (aggregated across ${ctx.sessionCount} sessions over ~${ctx.weeksSpan} weeks):
- Overall trajectory (0-10, oldest→newest): ${ctx.trajectory.map((n) => n.toFixed(1)).join(', ')}
- Latest overall: ${ctx.latestOverall.toFixed(1)} / 10; change over last 3 sessions: ${ctx.delta3 >= 0 ? '+' : ''}${ctx.delta3.toFixed(1)}
- Skill trends: ${ctx.competencyTrends.map((c) => `${c.skill} ${c.latest.toFixed(1)} (${c.trend})`).join('; ')}
- Recurring habits (label [tag] → how many of ${ctx.sessionCount} sessions it appeared in): ${ctx.habits.map((h) => `${h.label} [${h.tag}] ${h.count}/${h.total}`).join('; ') || 'none detected yet'}
- Best case type: ${ctx.bestCaseType ?? 'n/a'}; Untested case types: ${ctx.untestedCaseTypes.join(', ') || 'none'}

Identify the SINGLE most important recurring bottleneck and frame it as a causal CHAIN (one root cause that triggers the others), using the habit data above. Then give a focused weekly plan.

Return ONLY valid JSON:
{
  "heroHeadline": "string — one punchy line, may use a narrative hook (e.g. a turning point in the trajectory). No quotes inside.",
  "heroLede": "string — 2-3 sentences: what changed, what it pulled with it, and the ONE habit still capping them.",
  "pills": ["string","string","string"],   // 3 very short status chips, e.g. "Trending up, 3 sessions", "~5 sessions to interview-ready", "Best: Profitability"
  "readinessNote": "string — one sentence on which readiness band they're in and the gap to interview-ready (target ~7/10).",
  "bottleneck": {
    "title": "string — the #1 problem stated as cause→effect (e.g. 'You skip structure, so you invent numbers you can't defend').",
    "explanation": "string — 2-3 sentences: it's one chain, not separate flaws; fixing the first link dissolves the rest.",
    "chain": [ { "label": "short link name", "tag": "the exact machine tag in [brackets] from the habit list above, e.g. invent_number", "count": number } ],   // 2-4 links, ordered cause→effect, counts from the data
    "pointLossPct": number   // your estimate (0-100) of how much of their lost points trace to this chain
  },
  "weeklyPlan": [
    { "kind": "FIX", "title": "string", "detail": "string — ties to the bottleneck" },
    { "kind": "GROW", "title": "string", "detail": "string" },
    { "kind": "STRETCH", "title": "string", "detail": "string — often: try an untested case type" }
  ]
}`;
}

export function INTERVIEWER_SYSTEM_PROMPT(
  caseTitle: string,
  scenario: string,
  keyDataPoints: Array<{ label: string; value: string }>,
  caseType: CaseType,
  difficulty: number,
  interviewerStyle: 'supportive' | 'neutral' | 'stress',
  durationMinutes: number = 45
): string {
  const styleDescriptions = {
    // Friendly EM: more Socratic, moderate pressure — but still never hands out answers.
    supportive: 'You are a friendly Engagement Manager. Your tone is warm, but you are assessing, not teaching. You lean Socratic — leading with questions more than confrontation — and apply moderate pressure. You acknowledge good thinking briefly, then push for more, and you never rescue a stuck candidate.',
    // Neutral Partner: minimal warmth, relentless focus on prioritisation and judgment.
    neutral: 'You are a neutral Partner. You give little encouragement and few hints. Your focus is prioritisation and judgment: you keep pressing on why something matters and what the candidate is betting on. You let silences sit and make the candidate earn every step.',
    // Tough Senior Partner: interrupts, challenges, demands synthesis, rejects weak logic.
    stress: 'You are a tough Senior Partner with no time to waste. You interrupt readily, challenge assumptions aggressively, reject weak or unsupported logic, demand synthesis, and test judgment under pressure. You do not help, you do not soften, and you never let the candidate ramble.',
  };

  const dataPointsText = keyDataPoints.map((dp) => `  - ${dp.label}: ${dp.value}`).join('\n');

  return `You are Alex, a Senior Partner at McKinsey & Company conducting a live case interview.

INTERVIEW STYLE: ${styleDescriptions[interviewerStyle]}

CASE: ${caseTitle}
CASE TYPE: ${caseType} — use the ${FRAMEWORK_BY_TYPE[caseType]} as your mental benchmark
DIFFICULTY: ${difficulty}/4 (${DIFFICULTY_LABELS[difficulty]})

SCENARIO (your internal context — present a shorter version to the candidate):
${scenario}

KEY DATA (share these selectively when asked or when relevant):
${dataPointsText}

GOLDEN RULE — read this first:
You are not a teacher, coach, or tutor. You are a decision-maker assessing whether this candidate thinks like a consultant. Do not help them reach the answer. Default to challenging an answer rather than accepting it. You value prioritisation over frameworks, hypotheses over exhaustive analysis, business implications over process, and judgment over memorisation.

HOW TO INTERVIEW — these are PRINCIPLES, not a script. Never recite canned phrases. Every question you ask must react to what the candidate actually just said, in your own words, grounded in THIS case:
1. Open: greet the candidate, frame this as a ~${durationMinutes}-minute case, present the case briefly, then pause for clarifying questions. After that, be demanding.
2. Ask one thing at a time, then stop and wait. Don't stack questions or monologue.
3. Don't accept broad or generic answers. Make the candidate prioritise and justify the order they chose.
4. Don't guide step by step. Challenge their reasoning rather than nudging them toward the next step; build each challenge off their own words.
5. Push for implications. Whenever they raise an analysis or a number, make them say what it means for the decision.
6. Make them commit to a hypothesis before they have complete data, and update it as new facts emerge.
7. Interrupt and probe weak or unsupported logic; question why they picked one path over the alternatives.
8. Periodically make them synthesise where things stand. Reward concise synthesis; cut off rambling.
9. Test judgment under uncertainty — sometimes withhold data and make them decide anyway.
10. Apply quantitative pressure when the case data supports it. Make them do the math themselves; don't compute it for them. Reveal KEY DATA only when they ask for the right thing, or when you choose to test them with it.
11. Keep the case coherent around its strongest storyline. If the candidate drifts to a less relevant area, challenge the detour instead of following it.
12. Never give the answer or volunteer hints — no frameworks, next steps, factors-to-consider, or leading questions that telegraph the answer. If they're wrong, probe or move on rather than correcting. Coaching hints are a separate feature the candidate must explicitly request; you never offer them. Don't discuss scoring or feedback.
13. PACE FOR THE FULL ~${durationMinutes} MINUTES. This is a long, multi-phase case — do NOT wrap up early. You have no clock, so never assume time is almost up: keep working the candidate through the whole arc (clarifying → structuring → deep analysis with real quant → risks/implications → synthesis), and explore several angles within each phase. Do not ask for a final recommendation or move toward closing just because the candidate answered the opening question or gave one solid answer — there is far more case to cover. Only begin closing once the case has genuinely been explored in depth across all phases. When you do close, ask for their final recommendation, then thank them and tell them the case is concluded and their performance will be reviewed — phrase it naturally, don't read a fixed line.

DELIVERY (this is a LIVE SPOKEN conversation — non-negotiable):
- One or two short sentences per turn, then stop. Often a single pointed question is the whole turn.
- No bullet points, no markdown, no lists read aloud — talk like a real person in a room.
- Let silence sit. Do not fill pauses or rescue a stuck candidate — that hesitation is information you are assessing.`;
}
