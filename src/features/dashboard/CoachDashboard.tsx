import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Target } from 'lucide-react';
import { dashboardSource } from './api';
import { BASELINE_ROUTE, INTERVIEW_ROUTES } from './config';
import { buildTrackers, focusType, formatShortDate, pickNudge, type NudgeAction } from './logic';
import { shortLabel } from './format';
import type { DashboardOverview, RecentInterview, Targets, TypeKey } from './types';
import CoachCard from './components/CoachCard';
import { TrackerCard } from './components/TrackerCards';
import { LearnCard, TypeTable } from './components/TypeTable';
import { RecentInterviews, Weaknesses } from './components/WeaknessesAndRecent';
import PreInterviewCheck, { type CheckTarget } from './components/PreInterviewCheck';
import TargetsModal from './components/TargetsModal';
import IssueDrawer from './components/IssueDrawer';

type Modal =
  | { kind: 'check'; target: CheckTarget }
  | { kind: 'targets' }
  | { kind: 'issues'; interview: RecentInterview }
  | null;

interface Props {
  overview: DashboardOverview;
  firstName: string;
  /** Re-fetch the overview after a write. */
  reload: (opts?: { silent?: boolean }) => Promise<void>;
}

/** The returning-user dashboard: next action, pace, readiness by type, learning, history. */
export default function CoachDashboard({ overview, firstName, reload }: Props) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const now = useMemo(() => new Date(), [overview]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackers = buildTrackers(overview, now);
  const nudge = pickNudge(overview);
  const focus = focusType(overview);

  const closeModal = useCallback(() => { setModal(null); setSaveError(''); }, []);

  const goLesson = (l: { href: string }) => { setModal(null); navigate(l.href); };

  const startInterview = (target: CheckTarget) => {
    const r = target === 'baseline' ? BASELINE_ROUTE : INTERVIEW_ROUTES[target];
    setModal(null);
    navigate(r.to, { state: r.state });
  };

  const onAction = (a: NudgeAction) => {
    switch (a.do) {
      case 'lesson': return goLesson(a.lesson);
      case 'check': return setModal({ kind: 'check', target: a.type });
      case 'baseline': return setModal({ kind: 'check', target: 'baseline' });
    }
  };

  const saveTargets = async (targets: Targets) => {
    setSaving(true);
    setSaveError('');
    try {
      await dashboardSource.saveTargets(targets);
      await reload({ silent: true });
      setModal(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save your targets. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const { profile } = overview;
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const eyebrow = profile.placementDate ? `${dateLabel} · PLACEMENTS START ${formatShortDate(profile.placementDate).toUpperCase()}` : dateLabel;
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const typeOf = (k: TypeKey) => overview.types.find((t) => t.key === k);

  return (
    <div className="space-y-5 py-1">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="label-blueprint font-semibold">{eyebrow}</div>
          <h1 className="mt-1 font-headline font-bold text-2xl tracking-tight text-primary">{greeting}, {firstName}.</h1>
        </div>
        <button type="button" onClick={() => setModal({ kind: 'targets' })} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-on-tertiary-container hover:underline">
          <Target className="w-4 h-4" /> Edit targets
        </button>
      </header>

      <CoachCard overview={overview} nudge={nudge} onAction={onAction} />

      <div className="grid gap-4 md:grid-cols-2">
        <TrackerCard t={trackers.prep} />
        <TrackerCard t={trackers.interviews} />
      </div>

      <div className="flex flex-wrap gap-4 items-stretch">
        <TypeTable overview={overview} onStart={(k) => setModal({ kind: 'check', target: k })} />
        <LearnCard overview={overview} focus={focus.key} onLesson={goLesson} />
      </div>

      <div className="flex flex-wrap gap-4 items-stretch">
        <Weaknesses items={overview.weaknesses} onLesson={(href) => navigate(href)} />
        <RecentInterviews overview={overview} onOpen={(interview) => setModal({ kind: 'issues', interview })} />
      </div>

      <AnimatePresence>
        {modal?.kind === 'check' && (
          <PreInterviewCheck key="check" overview={overview} target={modal.target} onClose={closeModal} onStart={startInterview} onPrep={goLesson} />
        )}
        {modal?.kind === 'targets' && (
          <TargetsModal key="targets" overview={overview} saving={saving} error={saveError} onClose={closeModal} onSave={saveTargets} />
        )}
        {modal?.kind === 'issues' && (
          <IssueDrawer
            key="issues"
            interview={modal.interview}
            typeLabel={shortLabel(typeOf(modal.interview.typeKey) ?? { key: modal.interview.typeKey, label: modal.interview.typeKey })}
            onClose={closeModal}
            onTranscript={() => navigate(modal.interview.reportHref)}
            onRetry={() => setModal({ kind: 'check', target: modal.interview.typeKey })}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
