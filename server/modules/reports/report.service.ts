import { Report, IReport, OverallGrade } from '../../models/Report.js';
import { Session, TranscriptEntry } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateEvaluationWithAI, embedTexts, cosineSimilarity, buildReferenceTree, buildEvaluationTree, generateIdealTranscript } from '../../ai/client.js';
import { scoreTraversal } from './treeScore.js';
import { computePillarScore } from './pillarScore.js';
import { EvaluationContext } from '../../ai/prompts.js';
import { invalidateLessonCache } from '../coaching/coaching.service.js';

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

// Walk the reference tree's CORRECT nodes in ideal (priority) order → an ordered
// list of "Step N — <label>: <insight>" lines describing the highest-scoring path.
function idealStepsText(refTree: Record<string, unknown> | undefined): string {
  if (!refTree) return '';
  const status = (n: Record<string, unknown>): string => String(n.reference_status ?? n.status ?? 'neutral');
  const lines: string[] = [];
  let step = 0;
  const dfs = (n: Record<string, unknown>) => {
    const kids = (Array.isArray(n.children) ? n.children : []) as Array<Record<string, unknown>>;
    const correct = kids.filter((c) => status(c) === 'correct');
    for (const c of correct) {
      step += 1;
      const label = String(c.label ?? '').trim();
      const insight = String(c.insight ?? '').trim();
      lines.push(`Step ${step} — ${label}${insight ? `: ${insight}` : ''}`);
      dfs(c);
    }
  };
  // depth-1 buckets in rank order, then their correct subtrees.
  const buckets = ((Array.isArray(refTree.children) ? refTree.children : []) as Array<Record<string, unknown>>)
    .filter((c) => status(c) === 'correct')
    .sort((a, b) => (Number(a.rank ?? 99)) - (Number(b.rank ?? 99)));
  for (const b of buckets) {
    step += 1;
    lines.push(`Step ${step} — ${String(b.label ?? '').trim()}${b.insight ? `: ${String(b.insight).trim()}` : ''}`);
    dfs(b);
  }
  return lines.join('\n');
}

// Generate (and cache on the Report) a model transcript that walks the ideal
// solution path. Consulting cases only — those have a reference tree.
export async function getOrGenerateIdealTranscript(sessionId: string, userId: string): Promise<Array<{ role: string; text: string }>> {
  const report = await Report.findOne({ sessionId, userId });
  if (!report) throw new AppError(404, 'Report not found — open the report first');
  const cached = (report.analysis as Record<string, unknown> | undefined)?.idealTranscript;
  if (Array.isArray(cached) && cached.length) return cached as Array<{ role: string; text: string }>;

  const session = await Session.findOne({ _id: sessionId, userId }).populate('caseId');
  if (!session) throw new AppError(404, 'Session not found');
  const caseDoc = session.caseId as unknown as InstanceType<typeof Case>;
  if (!caseDoc) throw new AppError(400, 'No case attached to this session');

  // Prefer the cached reference tree (full MECE answer key); build it if missing.
  let refTree = caseDoc.referenceTree as Record<string, unknown> | undefined;
  if (!refTree) {
    try {
      refTree = await buildReferenceTree(serializeCasePackage(caseDoc));
      await Case.updateOne({ _id: caseDoc._id }, { $set: { referenceTree: refTree } }).catch(() => { /* non-fatal */ });
    } catch (e) { console.error('ideal-transcript: reference tree build failed:', e); }
  }

  const stepsText = idealStepsText(refTree) || (caseDoc.answerKey ?? caseDoc.plausibleSolution ?? '');
  const out = await generateIdealTranscript(serializeCasePackage(caseDoc), stepsText);
  const turns = Array.isArray(out.turns) ? out.turns.filter((t) => t && t.text) : [];
  if (turns.length) {
    await Report.updateOne({ sessionId, userId }, { $set: { 'analysis.idealTranscript': turns } }).catch((e) => console.error('cache ideal transcript failed:', e));
  }
  return turns;
}

// Serialize a Case doc into the text "package" the reference-tree builder reads.
function serializeCasePackage(c: InstanceType<typeof Case>): string {
  const parts: string[] = [
    `TITLE: ${c.title}`,
    `TYPE: ${c.type ?? ''} | INDUSTRY: ${c.industry ?? ''} | DIFFICULTY: ${c.difficulty}`,
    `BRIEF / SCENARIO: ${c.scenario}`,
  ];
  if (c.keyDataPoints?.length) {
    parts.push(`KEY DATA:\n${c.keyDataPoints.map((d) => `  - ${d.label}: ${d.value}`).join('\n')}`);
  }
  if (Array.isArray(c.exhibits) && c.exhibits.length) {
    parts.push(`EXHIBITS:\n${c.exhibits.map((e, i) => {
      const ex = e as Record<string, unknown>;
      return `  #${ex.id ?? i + 1} ${ex.label ?? ''} (${ex.visual ?? ''}) — data: ${ex.data ?? ''}${ex.insight ? ` | insight: ${ex.insight}` : ''}${ex.whenToShow ? ` | show when: ${ex.whenToShow}` : ''}`;
    }).join('\n')}`);
  }
  if (c.quant && (c.quant as Record<string, unknown>).task) {
    const q = c.quant as Record<string, unknown>;
    parts.push(`QUANT: task=${q.task} | derivation=${q.derivation ?? ''} | answer=${q.answer ?? ''}`);
  }
  if (c.privateMechanismNote) parts.push(`ROOT CAUSE / MECHANISM: ${c.privateMechanismNote}`);
  if (c.plausibleSolution || c.answerKey) parts.push(`SOLUTION: ${c.answerKey ?? c.plausibleSolution}`);
  if (c.commonWrongTurns?.length) parts.push(`COMMON WRONG ANSWERS:\n${c.commonWrongTurns.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`);
  return parts.join('\n\n');
}

const normLabel = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Merge the per-node candidate overlay onto the full reference tree (recursively),
// preserving every node, its depth, and its teaching `insight`. Matches the
// overlay by id first, then by label (so a slightly-off id still attaches).
// Nodes with no overlay are 'skipped'.
function mergeOverlay(
  node: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>,
  byLabel: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const id = node.id != null ? String(node.id) : '';
  const o = byId.get(id) ?? byLabel.get(normLabel(node.label));
  const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : [];
  return {
    id: node.id,
    label: node.label,
    depth: node.depth,
    insight: node.insight ?? null, // the right move / why-it-matters (teaching content)
    rank: node.rank ?? null,       // depth-1 buckets: impact rank (for the scorecard)
    critical: node.critical === true || node.critical === 'true', // must-find insight (Navigation critical-path)
    reference_status: node.reference_status ?? node.status ?? 'neutral',
    candidate_status: o?.candidate_status ?? 'skipped',
    quality: o?.quality ?? 'n/a',
    time_spent: o?.time_spent ?? null,
    candidate_quotes: o?.candidate_quotes ?? [],
    evaluation_note: o?.evaluation_note ?? null,
    exhibit_shared: o?.exhibit_shared ?? null,
    was_nudged: o?.was_nudged ?? false,
    recommended_path: o?.recommended_path ?? null,
    children: children.map((c) => mergeOverlay(c, byId, byLabel)),
  };
}

// Build the Stage-2 reference tree + Stage-3 evaluation tree (consulting only).
// The reference tree is cached on the Case so it's generated once per case. All
// best-effort: a failure here never blocks the report. Returns what to merge
// into `analysis`.
// Attach the deterministic per-node points onto the merged tree (for the viz).
function attachPoints(node: Record<string, unknown>, points: Record<string, number>): void {
  const id = node.id != null ? String(node.id) : '';
  if (id in points) node.points = points[id];
  const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : [];
  children.forEach((c) => attachPoints(c, points));
}

async function buildCaseTrees(
  caseDoc: InstanceType<typeof Case>,
  transcript: string
): Promise<{ evaluationTree?: unknown; treeSummary?: unknown; treeScore?: unknown } | null> {
  try {
    let refTree = caseDoc.referenceTree;
    if (!refTree) {
      refTree = await buildReferenceTree(serializeCasePackage(caseDoc));
      // Cache on the Case for reuse across this case's other sessions.
      await Case.updateOne({ _id: caseDoc._id }, { $set: { referenceTree: refTree } }).catch(() => { /* non-fatal */ });
    }
    const evalOut = await buildEvaluationTree(JSON.stringify(refTree), transcript);
    // The eval step returns only a small per-node overlay (keyed by id) — NOT the
    // whole tree — so it never gets truncated and the FULL reference-tree depth
    // survives. Merge the overlay onto the cached reference tree here.
    const overlays = Array.isArray(evalOut.overlays) ? (evalOut.overlays as Array<Record<string, unknown>>) : [];
    const byId = new Map(overlays.filter((o) => o.id != null).map((o) => [String(o.id), o]));
    const byLabel = new Map(overlays.filter((o) => o.label != null).map((o) => [normLabel(o.label), o]));
    const merged = mergeOverlay(refTree as Record<string, unknown>, byId, byLabel);

    // Deterministic traversal score (spec engine) from the ordered visit list.
    const traversal = Array.isArray(evalOut.traversal) ? (evalOut.traversal as Array<{ id?: string; was_nudged?: boolean }>) : [];
    let treeScore: unknown;
    try {
      const score = scoreTraversal(refTree as Record<string, unknown>, traversal);
      attachPoints(merged, score.perNodePoints);
      // Store everything except the per-node map (that's already on the tree).
      const { perNodePoints, ...rest } = score; void perNodePoints;
      treeScore = rest;
    } catch (e) {
      console.error('tree scoring failed (non-fatal):', e);
    }

    return { evaluationTree: merged, treeSummary: evalOut.summary, treeScore };
  } catch (e) {
    console.error('case-tree build failed (non-fatal):', e);
    return null;
  }
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

  const kindLabel = caseDoc.type ?? caseDoc.module ?? 'case';
  const difficultyLabel = `${DIFFICULTY_LABELS[session.config.difficulty] ?? 'Intermediate'} ${kindLabel} ${caseDoc.module === 'guesstimate' ? '' : 'case'}`.trim();
  const durationLabel = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;

  // Kick the case-tree build off NOW, concurrently with the evaluation — it only
  // needs the case + transcript, not the analysis, and (on a case's first report)
  // the reference-tree build is the long pole. Running them in parallel turns the
  // report wall-time from eval + trees into max(eval, trees).
  const treesPromise = (caseDoc.module ?? 'case') === 'case'
    ? buildCaseTrees(caseDoc, timestampedTranscript)
    : Promise.resolve(null);

  const analysis: any = await generateEvaluationWithAI({
    timestampedTranscript,
    caseTitle: caseDoc.title,
    caseType: kindLabel,
    module: caseDoc.module ?? 'case',
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

  // Enforce the integrity policy deterministically (don't trust the model's own
  // status field): SUPPRESS scores only when a CRITICAL signal fired AND there's a
  // corroborating second signal; FLAG at 2+ signals; otherwise NORMAL. This keeps a
  // single incidental meta-comment ("are you an AI?") from nuking the whole report.
  if (analysis.integrity && Array.isArray(analysis.integrity.signals)) {
    const sigs = analysis.integrity.signals as any[];
    const critical = sigs.filter((s) => s?.severity === 'CRITICAL').length;
    analysis.integrity.status =
      critical >= 1 && sigs.length >= 2 ? 'SUPPRESSED' : sigs.length >= 2 ? 'FLAGGED' : 'NORMAL';
  }

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

  // Stages 2+3 (consulting): collect the journey-vs-answer-key trees we started
  // building in parallel above. Best-effort — never blocks the report.
  const trees = await treesPromise;
  if (trees) {
    analysis.evaluationTree = trees.evaluationTree;
    analysis.treeSummary = trees.treeSummary;
    analysis.treeScore = trees.treeScore;
  }

  // Three-pillar composite (Case Owl scoring framework): Navigation (40%) from
  // the case map + Structure/Communication (30/30) from the LLM scorecard →
  // composite → percentile → verdict. Consulting cases only (needs the case map).
  if ((caseDoc.module ?? 'case') === 'case' && trees?.treeScore) {
    try {
      // Navigation (40%) is derived from the case map's own grade + Global%;
      // Structure/Communication (30/30) from the LLM scorecard.
      analysis.pillarScore = computePillarScore({ treeScore: trees.treeScore, scorecard: analysis.scorecard });
    } catch (e) {
      console.error('pillar composite failed (non-fatal):', e);
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

  const created = await Report.create({
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

  // New session data changes the live lesson exemplars — refresh the cache.
  invalidateLessonCache();
  return created;
}
