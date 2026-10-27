import { BASELINE_MINUTES } from '../config';
import { pendingLessons } from '../logic';
import type { DashboardOverview, LessonRef, TypeKey } from '../types';
import Overlay from './Overlay';

export type CheckTarget = TypeKey | 'baseline';

interface Props {
  overview: DashboardOverview;
  target: CheckTarget;
  busy?: boolean;
  onClose: () => void;
  onStart: (target: CheckTarget) => void;
  onPrep: (lesson: LessonRef) => void;
}

/** Shown before every interview: a nudge to prep first when prep is thin, otherwise a quick confirm. */
export default function PreInterviewCheck({ overview, target, busy, onClose, onStart, onPrep }: Props) {
  const baseline = target === 'baseline';
  const type = baseline ? null : overview.types.find((t) => t.key === target) ?? null;

  const done = type?.lessonsDone ?? 0;
  const total = type?.lessonsTotal ?? 0;
  const lowPrep = !!type && total > 0 && done / total < 0.5;
  const pending = type ? pendingLessons(overview, type.key).slice(0, 2) : [];
  const showPrep = lowPrep && pending.length > 0;

  let eyebrow = 'READY TO START';
  let eyebrowCls = 'text-on-tertiary-container';
  let title = `${type?.label ?? ''} interview`;
  let body = `Prep is at ${done} of ${total} lessons. You’re set for this one.`;
  if (baseline) {
    eyebrow = 'BASELINE INTERVIEW';
    title = `${BASELINE_MINUTES} minutes. No prep needed.`;
    body = 'This is a starting point, not a test. Answer the way you would today; your scores per type set where the coach points you next.';
  } else if (showPrep) {
    eyebrow = 'BEFORE YOU START';
    eyebrowCls = 'text-amber-700';
    title = `Your ${type!.label.toLowerCase()} prep is at ${done} of ${total} lessons.`;
    body = overview.coach?.gaps?.[type!.key]
      ?? `You’ve done ${done} of ${total} ${type!.label.toLowerCase()} lessons. One or two now will make this interview count for more.`;
  }

  const primaryCls = 'px-4 py-2.5 rounded-lg text-sm font-bold bg-primary text-on-primary hover:bg-primary-container transition disabled:opacity-60';
  const secondaryCls = 'px-4 py-2.5 rounded-lg text-sm font-semibold text-secondary border border-outline-variant/50 hover:text-primary hover:border-primary/40 transition disabled:opacity-50';

  return (
    <Overlay onClose={onClose} labelledBy="check-title">
      <div className={`label-blueprint font-bold ${eyebrowCls}`}>{eyebrow}</div>
      <h2 id="check-title" className="mt-2 font-headline font-extrabold text-xl text-primary leading-snug">{title}</h2>
      <p className="mt-2 text-sm text-secondary leading-relaxed">{body}</p>

      {showPrep && (
        <div className="mt-4 rounded-xl border border-outline-variant/30 overflow-hidden">
          <div className="px-3.5 py-2 label-blueprint border-b border-outline-variant/20">CLOSES THE GAP</div>
          {pending.map((l) => (
            <div key={l.id} className="flex justify-between gap-3 px-3.5 py-2.5 text-[13px] border-b last:border-b-0 border-outline-variant/15">
              <span className="font-semibold text-primary">{l.title}</span>
              <span className="text-secondary shrink-0">{l.minutes} min</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2.5">
        {showPrep ? (
          <>
            <button type="button" disabled={busy} onClick={() => onStart(target)} className={secondaryCls}>Interview anyway</button>
            <button type="button" onClick={() => onPrep(pending[0])} className={primaryCls}>Prep first · {pending[0].minutes} min</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} className={secondaryCls}>{baseline ? 'Not now' : 'Cancel'}</button>
            <button type="button" disabled={busy} onClick={() => onStart(target)} className={primaryCls}>{baseline ? 'Start baseline' : 'Start interview'}</button>
          </>
        )}
      </div>
    </Overlay>
  );
}
