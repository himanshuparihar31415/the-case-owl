// The compact PM interview state object (spec §5 state machine + §8 context
// management). It accumulates the candidate's journey turn-by-turn so each LLM
// call gets a small, structured snapshot instead of the full transcript.
//
// P2 scope: stage tracking + journey accumulation + last-N-turns + a serialized
// snapshot for the prompt. The coherence engine and the 10-turn summary
// compression are layered on in P3.

export type PmStage =
  | 'clarification'
  | 'user_identification'
  | 'pain_points'
  | 'prioritization'
  | 'solutions'
  | 'solution_deep_dive'
  | 'metrics'
  | 'risks'
  | 'summary';

// Canonical order (§5.1). Used to advance current_stage when a turn marks the
// current stage complete.
export const PM_STAGES: PmStage[] = [
  'clarification',
  'user_identification',
  'pain_points',
  'prioritization',
  'solutions',
  'solution_deep_dive',
  'metrics',
  'risks',
  'summary',
];

export interface PmStateUpdate {
  stage_complete: boolean;
  new_user_choice: string | null;
  new_pain_point: string | null;
  new_solution: string | null;
  new_metric: string | null;
  flag_concern: { type: string; detail: string; severity: string } | null;
}

interface RecentTurn { role: 'interviewer' | 'candidate'; text: string }

const RECENT_TURNS_KEPT = 10; // ~5 exchanges verbatim (§8.3)

export class PmState {
  product: string;
  prompt: string;
  format: string;
  difficulty: number;

  chosenUser: { segment: string } | null = null;
  painPoints: string[] = [];
  solutions: string[] = [];
  metrics: string[] = [];

  currentStage: PmStage = 'clarification';
  stagesCompleted: PmStage[] = [];
  qualityTrend: number[] = [];

  private recent: RecentTurn[] = [];
  private stageTransitions: Array<{ from: PmStage; to: PmStage; t: string; quality: string }> = [];

  constructor(args: { product: string; prompt: string; format: string; difficulty: number }) {
    this.product = args.product;
    this.prompt = args.prompt;
    this.format = args.format;
    this.difficulty = args.difficulty;
  }

  recordTurn(role: 'interviewer' | 'candidate', text: string): void {
    this.recent.push({ role, text });
    if (this.recent.length > RECENT_TURNS_KEPT) this.recent.splice(0, this.recent.length - RECENT_TURNS_KEPT);
  }

  /** Apply a turn's quality + state_update, advancing the stage if marked complete. */
  applyTurn(responseQuality: number, update: PmStateUpdate): void {
    if (Number.isFinite(responseQuality)) this.qualityTrend.push(responseQuality);
    if (update.new_user_choice) this.chosenUser = { segment: update.new_user_choice };
    if (update.new_pain_point) this.painPoints.push(update.new_pain_point);
    if (update.new_solution) this.solutions.push(update.new_solution);
    if (update.new_metric) this.metrics.push(update.new_metric);
    if (update.stage_complete) this.advanceStage();
  }

  private advanceStage(): void {
    if (!this.stagesCompleted.includes(this.currentStage)) this.stagesCompleted.push(this.currentStage);
    const idx = PM_STAGES.indexOf(this.currentStage);
    const next = PM_STAGES[idx + 1];
    if (next) {
      this.stageTransitions.push({ from: this.currentStage, to: next, t: new Date().toISOString(), quality: 'clean' });
      this.currentStage = next;
    }
  }

  private avgQuality(): number {
    if (!this.qualityTrend.length) return 0;
    return this.qualityTrend.reduce((a, b) => a + b, 0) / this.qualityTrend.length;
  }

  /** Adaptive-difficulty hint (§9) derived from the running quality trend. */
  difficultyHint(): string {
    const avg = this.avgQuality();
    if (!this.qualityTrend.length) return 'No signal yet — open at a standard depth.';
    if (avg >= 7) return 'They are strong — push harder: second-order effects, edge cases, risks, challenge assumptions.';
    if (avg >= 4) return 'Mixed — standard probing: ask for specifics, examples, and justifications; push for depth.';
    return 'They are struggling — simplify and scaffold with a question (never hand them the answer).';
  }

  recentTurnsText(): string {
    if (!this.recent.length) return '(none yet)';
    return this.recent.map((t) => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.text}`).join('\n');
  }

  /** The "journey so far" + "current state" block injected into each turn (§6.1). */
  serialize(): string {
    const remaining = PM_STAGES.filter((s) => s !== this.currentStage && !this.stagesCompleted.includes(s));
    return `CANDIDATE'S JOURNEY SO FAR:
  Chosen user segment: ${this.chosenUser?.segment ?? '(not chosen yet)'}
  Pain points identified: ${this.painPoints.length ? this.painPoints.map((p, i) => `${i + 1}. ${p}`).join('; ') : '(none yet)'}
  Solutions proposed: ${this.solutions.length ? this.solutions.join('; ') : '(none yet)'}
  Metrics defined: ${this.metrics.length ? this.metrics.join('; ') : '(none yet)'}

CURRENT STATE:
  Stage: ${this.currentStage}
  Stages completed: ${this.stagesCompleted.length ? this.stagesCompleted.join(', ') : '(none)'}
  Stages remaining: ${remaining.join(', ')}
  Quality trend: ${this.qualityTrend.length ? this.qualityTrend.join(', ') : '(no turns scored yet)'}
  Adaptive difficulty: ${this.difficultyHint()}`;
  }

  /** Final compact state object persisted at session end (§16 state_object). */
  snapshot(): Record<string, unknown> {
    return {
      product: this.product,
      prompt: this.prompt,
      format: this.format,
      chosenUser: this.chosenUser,
      painPoints: this.painPoints,
      solutions: this.solutions,
      metrics: this.metrics,
      currentStage: this.currentStage,
      stagesCompleted: this.stagesCompleted,
      qualityTrend: this.qualityTrend,
      stageTransitions: this.stageTransitions,
    };
  }

  getStageTransitions(): Array<{ from: string; to: string; t: string; quality: string }> {
    return this.stageTransitions;
  }
}
