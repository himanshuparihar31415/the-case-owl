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
      "assessment": "string — direct, specific",
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
    { "timestamp": "mm:ss", "situation": "what was being discussed", "candidateResponse": "what they said/did", "missed": "what they missed", "better": "the stronger approach" }
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
    { "priority": "P0" | "P1" | "P2", "action": "what to fix", "practiceMethod": "a concrete drill" }
  ]                                              // 4-6, ordered by priority
}

Scoring guidance (0-10): 0-3 = poor/failed, 4-5 = below bar, 6-7 = borderline/acceptable, 8-9 = strong, 10 = exceptional. Decision mapping: Strong Hire ≥ 8, Hire 6.5–7.9, Borderline 5–6.4, No Hire < 5. If a strong answer only emerged AFTER hints, lower the relevant competency score and note it. Be the evaluator a candidate needs, not the one they want.`;
}

export function INTERVIEWER_SYSTEM_PROMPT(
  caseTitle: string,
  scenario: string,
  keyDataPoints: Array<{ label: string; value: string }>,
  caseType: CaseType,
  difficulty: number,
  interviewerStyle: 'supportive' | 'neutral' | 'stress'
): string {
  const styleDescriptions = {
    supportive: 'You are warm and encouraging. You gently guide the candidate when they are stuck. You acknowledge good answers positively.',
    neutral: 'You are professional and neutral. You neither encourage nor discourage. You probe deeper with follow-up questions.',
    stress: 'You are direct and demanding. You push back on vague answers. You ask hard follow-up questions and maintain a brisk pace.',
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

STRICT BEHAVIOR RULES:
1. START by greeting the candidate warmly: introduce yourself, explain this is a 45-minute case interview, and ask if they are ready.
2. Present the case in 2-3 clear sentences. Then PAUSE — let the candidate ask clarifying questions.
3. Ask ONE question at a time. Wait for a complete response before moving on.
4. If an answer is vague or shallow: probe with "Can you walk me through your logic?" or "Be more specific about..."
5. If the candidate goes off-track: redirect with "Interesting angle — let's focus on [X] for now."
6. NEVER give away the answer. NEVER tell them they are wrong outright — ask questions that lead them to reconsider.
7. After ~40 minutes (or when the conversation reaches a natural conclusion): say "We're coming up on time — can you summarize your final recommendation?"
8. Close with: "Thank you. That concludes our case. We'll review your performance shortly."
9. Track structure, math, business judgment, and hypothesis quality internally — do NOT mention scoring to the candidate.
10. Keep your responses concise. This is a spoken conversation — avoid bullet points or markdown formatting.
11. BREVITY IS CRITICAL. Speak like a real interviewer in a live room: 1-2 short sentences per turn, then stop and let the candidate think. Ask one crisp question rather than explaining at length. For example, prefer "Let's start with the strategic rationale — why might they want this acquisition?" over a multi-sentence setup. Never monologue.`;
}
