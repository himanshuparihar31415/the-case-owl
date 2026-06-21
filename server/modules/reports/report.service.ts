import { Report, IReport, OverallGrade } from '../../models/Report.js';
import { Session, TranscriptEntry } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateEvaluationWithAI, embedTexts, cosineSimilarity } from '../../ai/client.js';
import { EvaluationContext } from '../../ai/prompts.js';

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert',
};

const FILLER_PATTERNS: Array<{ word: string; re: RegExp }> = [
  { word: 'uh', re: /\buh+\b/gi },
  { word: 'um', re: /\bu+m+\b/gi },
  { word: 'er', re: /\ber+\b/gi },
  { word: 'like', re: /\blike\b/gi },
  { word: 'basically', re: /\bbasically\b/gi },
  { word: 'actually', re: /\bactually\b/gi },
  { word: 'you know', re: /\byou know\b/gi },
  { word: 'i mean', re: /\bi mean\b/gi },
  { word: 'sort of', re: /\bsort of\b/gi },
  { word: 'kind of', re: /\bkind of\b/gi },
  { word: 'literally', re: /\bliterally\b/gi },
  { word: 'right', re: /\bright\b/gi },
];

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface Computed {
  timestampedTranscript: string;
  metrics: EvaluationContext['fluencyMetrics'];
  hintsUsed: number;
}

function computeMetrics(transcript: TranscriptEntry[], startedAt: Date, durationSeconds: number): Computed {
  const start = startedAt.getTime();

  const lines: string[] = [];
  const candidateTexts: string[] = [];
  const candidateWordCounts: number[] = [];
  let candidateSpeakingSec = 0;
  let longPauses = 0;
  let hintsUsed = 0;
  // v2: where long pauses fell, so we can describe WHEN they clustered, not just count.
  const pauseOffsets: number[] = [];
  let lastOffset = 0;

  for (let i = 0; i < transcript.length; i++) {
    const t = transcript[i];
    const offset = t.timestamp ? t.timestamp.getTime() - start : 0;
    if (offset > lastOffset) lastOffset = offset;
    const isHint = t.text.startsWith('[HINT]');
    if (isHint) hintsUsed++;
    lines.push(`[${fmtTime(offset)}] ${t.role.toUpperCase()}${isHint ? ' (HINT)' : ''}: ${t.text}`);

    if (t.role === 'candidate' && !isHint) {
      candidateTexts.push(t.text);
      candidateWordCounts.push(wordCount(t.text));
      // Approximate this turn's elapsed time from the previous turn (think+speak).
      if (i > 0 && transcript[i - 1].timestamp && t.timestamp) {
        const gap = (t.timestamp.getTime() - transcript[i - 1].timestamp.getTime()) / 1000;
        const capped = Math.min(Math.max(gap, 0), 180);
        candidateSpeakingSec += capped;
        if (gap > 3) { longPauses++; pauseOffsets.push(offset); }
      }
    }
  }

  const fullText = candidateTexts.join(' ');
  const totalWords = candidateWordCounts.reduce((a, b) => a + b, 0);

  // Filler words
  const fillerWords = FILLER_PATTERNS
    .map(({ word, re }) => ({ word, count: (fullText.match(re) || []).length }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
  const fillerWordTotal = fillerWords.reduce((a, b) => a + b.count, 0);

  // Repeated 3-gram phrases (rough)
  const tokens = fullText.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const grams = new Map<string, number>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    const g = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  const repeatedPhrases = [...grams.values()].filter((c) => c > 1).length;

  const responses = candidateWordCounts.length;
  const concise = candidateWordCounts.filter((w) => w > 0 && w <= 60).length;
  const conciseAnswerRate = responses ? Math.round((concise / responses) * 100) : 0;
  const longestResponseWords = responses ? Math.max(...candidateWordCounts) : 0;
  const avgWordsPerResponse = responses ? Math.round(totalWords / responses) : 0;

  // v2: concise rate over SUBSTANTIVE responses only — exclude acks/restarts
  // (<4 words like "Got it", "Sure", "Hmm") that inflate the v1 rate.
  const substantiveCounts = candidateWordCounts.filter((w) => w >= 4);
  const substantiveResponses = substantiveCounts.length;
  const substantiveConcise = substantiveCounts.filter((w) => w <= 60).length;
  const substantiveConciseRate = substantiveResponses
    ? Math.round((substantiveConcise / substantiveResponses) * 100)
    : 0;

  // v2: bucket long pauses into early/mid/late thirds of the interview.
  const span = lastOffset || durationSeconds * 1000 || 1;
  const pauseDistribution = { early: 0, mid: 0, late: 0 };
  for (const off of pauseOffsets) {
    const frac = off / span;
    if (frac < 1 / 3) pauseDistribution.early++;
    else if (frac < 2 / 3) pauseDistribution.mid++;
    else pauseDistribution.late++;
  }

  // v2: rough % of case stages reached (premature-termination signal). A full
  // case has the candidate speaking through clarify→structure→analysis→synthesis;
  // ~6 substantive turns ≈ a complete traversal.
  const stagesCompletedPct = Math.min(100, Math.round((substantiveResponses / 6) * 100));

  // WPM: candidate words over estimated speaking time (fallback to session duration).
  const speakingMin = candidateSpeakingSec > 0 ? candidateSpeakingSec / 60 : durationSeconds / 60;
  const wordsPerMinute = speakingMin > 0 ? Math.round(totalWords / speakingMin) : 0;

  return {
    timestampedTranscript: lines.join('\n'),
    hintsUsed,
    metrics: {
      wordsPerMinute,
      fillerWordTotal,
      fillerWords,
      repeatedPhrases,
      conciseAnswerRate,
      longestResponseWords,
      avgWordsPerResponse,
      longPauses,
      substantiveConciseRate,
      substantiveResponses,
      pauseDistribution,
      stagesCompletedPct,
    },
  };
}

// ── Derive legacy fields (consumed by analytics/dashboard) from the rich report ──
const RICH_TO_LEGACY: Record<string, string> = {
  structure: 'structuring',
  math: 'quantitative',
  businessJudgment: 'businessJudgment',
  communication: 'communication',
  creativity: 'synthesis',
  hypothesis: 'hypothesis',
};

function richScore(analysis: any, richKey: string): number {
  const comp = (analysis?.competencies as any[] | undefined)?.find((c) => c?.key === richKey);
  const s = typeof comp?.score === 'number' ? comp.score : 5;
  return Math.round(s * 10); // 0-10 → 0-100
}

const DECISION_TO_GRADE: Record<string, OverallGrade> = {
  'Strong Hire': 'STRONG_PASS',
  Hire: 'PASS',
  Borderline: 'BORDERLINE',
  'No Hire': 'FAIL',
};

function buildProgressRow(r: { generatedAt: Date; overallScore: number; analysis?: any; metrics?: any }) {
  const a = r.analysis;
  const score10 = a?.overall?.score ?? r.overallScore / 10;
  const comp = (key: string, legacyFallback: number) => {
    const c = (a?.competencies as any[] | undefined)?.find((x) => x?.key === key);
    return typeof c?.score === 'number' ? c.score : legacyFallback;
  };
  return {
    date: r.generatedAt,
    overallScore: Math.round(score10 * 10) / 10,
    structuring: comp('structuring', 0),
    quantitative: comp('quantitative', 0),
    communication: comp('communication', 0),
    grammar: a?.communication?.grammar?.score ?? null,
    fillerWords: r.metrics?.fillerWordTotal ?? null,
  };
}

export async function getOrGenerateReport(sessionId: string, userId: string): Promise<IReport> {
  const existing = await Report.findOne({ sessionId, userId });
  if (existing) return existing;
  return generateReport(sessionId, userId);
}

export async function generateReport(sessionId: string, userId: string): Promise<IReport> {
  const session = await Session.findOne({ _id: sessionId, userId }).populate('caseId');
  if (!session) throw new AppError(404, 'Session not found');
  if (session.status !== 'completed') throw new AppError(400, 'Session must be completed before generating a report');
  if (session.transcript.length === 0) throw new AppError(400, 'No transcript available for scoring');

  const caseDoc = session.caseId as unknown as InstanceType<typeof Case>;
  const durationSeconds = session.durationSeconds ?? 0;

  const { timestampedTranscript, metrics, hintsUsed } = computeMetrics(
    session.transcript, session.startedAt, durationSeconds
  );

  const difficultyLabel = `${DIFFICULTY_LABELS[session.config.difficulty] ?? 'Intermediate'} ${caseDoc.type} case`;
  const durationLabel = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;

  const analysis: any = await generateEvaluationWithAI({
    timestampedTranscript,
    caseTitle: caseDoc.title,
    caseType: caseDoc.type,
    difficultyLabel,
    durationLabel,
    hintsUsed,
    fluencyMetrics: metrics,
  });

  // Inject the deterministic metrics so the UI shows measured (not invented) numbers.
  if (analysis.communication?.fluency) {
    analysis.communication.fluency.metrics = metrics;
  }
  if (analysis.hintDependency) {
    analysis.hintDependency.hintsUsed = hintsUsed;
  }
  analysis.difficultyLabel = difficultyLabel;
  analysis.durationLabel = durationLabel;

  // Ideal-answer quality gate (spec 3.3): the model answer must be substantively
  // DIFFERENT from the candidate's, not a rephrase. Embed both, measure cosine; if
  // they're too similar (>= 0.7) the candidate's answer was already strong, so flip
  // the UI to "on target — marginal improvement" framing rather than a fake "stronger".
  const ideals: any[] = Array.isArray(analysis.idealAnswers) ? analysis.idealAnswers : [];
  if (ideals.length > 0) {
    try {
      const pairs = ideals.flatMap((q) => [String(q?.candidateAnswer ?? ''), String(q?.modelAnswer ?? q?.strongerAnswer ?? '')]);
      const vecs = await embedTexts(pairs);
      ideals.forEach((q, i) => {
        const sim = cosineSimilarity(vecs[i * 2] ?? [], vecs[i * 2 + 1] ?? []);
        q.similarityScore = Math.round(sim * 100) / 100;
        q.alreadyStrong = sim >= 0.7; // too similar to teach anything new
      });
    } catch (e) {
      console.error('ideal-answer similarity gate failed (non-fatal):', e);
    }
  }

  // Derive legacy fields for analytics/dashboard compatibility.
  const overallScore = Math.round(((analysis.overall?.score ?? 5) as number) * 10);
  const overallGrade = DECISION_TO_GRADE[analysis.overall?.decision as string] ?? 'BORDERLINE';
  const competencies = {
    structure: { score: richScore(analysis, RICH_TO_LEGACY.structure) },
    math: { score: richScore(analysis, RICH_TO_LEGACY.math) },
    businessJudgment: { score: richScore(analysis, RICH_TO_LEGACY.businessJudgment) },
    communication: { score: richScore(analysis, RICH_TO_LEGACY.communication) },
    creativity: { score: richScore(analysis, RICH_TO_LEGACY.creativity) },
    hypothesis: { score: richScore(analysis, RICH_TO_LEGACY.hypothesis) },
  };
  const feedback = {
    strengths: (analysis.doneWell as string[]) ?? [],
    improvements: (analysis.needsImprovement as string[]) ?? [],
    momentsOfExcellence: (analysis.overall?.primaryStrengths as string[]) ?? [],
    missedOpportunities: ((analysis.missedOpportunities as any[]) ?? []).map(
      (m) => `${m?.timestamp ? `[${m.timestamp}] ` : ''}${m?.missed ?? ''}`
    ),
    keyHypotheses: [] as string[],
  };
  const executiveSummary = (analysis.overall?.summary as string) ?? 'Evaluation complete.';

  // Build progress trend from the user's prior reports + this one. Skip sessions
  // whose scores were SUPPRESSED for integrity reasons — anomalous sessions
  // shouldn't pollute the trend.
  const notSuppressed = (an: any) => an?.integrity?.status !== 'SUPPRESSED';
  const prior = await Report.find({ userId })
    .sort({ generatedAt: 1 })
    .select('overallScore analysis metrics generatedAt sessionId');
  const progress = [
    ...prior
      .filter((r) => r.sessionId?.toString() !== sessionId && notSuppressed((r as any).analysis))
      .map((r) => buildProgressRow(r as any)),
    ...(notSuppressed(analysis)
      ? [buildProgressRow({ generatedAt: new Date(), overallScore, analysis, metrics })]
      : []),
  ];

  await Report.deleteOne({ sessionId, userId });

  return Report.create({
    sessionId,
    userId,
    overallScore,
    overallGrade,
    competencies,
    feedback,
    executiveSummary,
    analysis,
    metrics,
    progress,
    generatedAt: new Date(),
  });
}
