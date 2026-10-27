import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Check, Loader2 } from 'lucide-react';
import { dashboardSource } from './api';
import { BASELINE_MINUTES, BASELINE_ROUTE, ONBOARDING_OPTIONS } from './config';
import { lessonFor, leastComfortable, suggestTargets } from './logic';
import type { DashboardOverview, LessonRef, OnboardingAnswers, TypeKey } from './types';
import PreInterviewCheck from './components/PreInterviewCheck';
import { cn } from '@/src/lib/utils';

const STEPS = ['Target role', 'Companies', 'Timeline', 'Comfort', 'Your plan'] as const;
const LAST = STEPS.length - 1;
const DRAFT_KEY = 'dashboard_onboarding_draft_v1';

interface Draft { step: number; roles: string[]; companies: string[]; timeline: string; comfort: Partial<Record<TypeKey, number>> }
const EMPTY: Draft = { step: 0, roles: [], companies: [], timeline: '', comfort: {} };

// Answers survive a refresh mid-way; storage being unavailable just means they don't.
const loadDraft = (): Draft => {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft> & { role?: string };
    // Drafts saved before multi-select stored a single `role`.
    const roles = raw.roles ?? (raw.role ? [raw.role] : []);
    return { ...EMPTY, ...raw, roles };
  } catch { return EMPTY; }
};
const saveDraft = (d: Draft) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

const pill = (on: boolean) => cn(
  'rounded-full border text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
  on ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-primary border-outline-variant/60 hover:border-primary/50',
);

interface Props {
  overview: DashboardOverview;
  firstName: string;
  reload: (opts?: { silent?: boolean }) => Promise<void>;
}

/** First-login flow: five short questions, a plan preview, then a choice of how to start. */
export default function Onboarding({ overview, firstName, reload }: Props) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [baselineOpen, setBaselineOpen] = useState(false);

  useEffect(() => { saveDraft(draft); }, [draft]);

  const { step } = draft;
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const comfortOf = (k: TypeKey) => draft.comfort[k] ?? 3;

  const canContinue = step === 0 ? draft.roles.length > 0 : step === 2 ? !!draft.timeline : true;

  const answers = (): OnboardingAnswers => ({
    roles: draft.roles,
    companies: draft.companies,
    timeline: draft.timeline,
    comfort: Object.fromEntries(overview.types.map((t) => [t.key, comfortOf(t.key)])) as Record<TypeKey, number>,
  });

  const targets = suggestTargets(draft.timeline || '1–2 months');
  const lowest = leastComfortable(overview.types, Object.fromEntries(overview.types.map((t) => [t.key, comfortOf(t.key)])) as Record<TypeKey, number>);
  const firstLesson: LessonRef | null = lessonFor(overview, lowest.key);

  /** Saves the answers (marks the user onboarded), then goes where they chose to start. */
  const finish = async (go: () => void) => {
    setSaving(true);
    setError('');
    try {
      await dashboardSource.completeOnboarding(answers());
      clearDraft();
      go();
      // The dashboard now renders for this user: refresh in the background so Back returns to it.
      void reload({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your plan. Please try again.');
      setSaving(false);
      setBaselineOpen(false);
    }
  };

  const startBaseline = () => finish(() => navigate(BASELINE_ROUTE.to, { state: BASELINE_ROUTE.state }));
  const startPrep = () => finish(() => navigate(firstLesson?.href ?? '/learn'));

  const toggleRole = (r: string) =>
    set({ roles: draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r] });

  const toggleCompany = (c: string) =>
    set({ companies: draft.companies.includes(c) ? draft.companies.filter((x) => x !== c) : [...draft.companies, c] });

  const rolesSummary = draft.roles.join(', ');

  const companySummary = draft.companies.length
    ? draft.companies.slice(0, 3).join(', ') + (draft.companies.length > 3 ? ` +${draft.companies.length - 3}` : '')
    : 'no companies yet';

  const heading = 'font-headline font-bold text-lg text-primary';
  const sub = 'mt-1 text-sm text-secondary';

  return (
    <div className="space-y-5 py-1 max-w-5xl mx-auto">
      <header>
        <div className="label-blueprint font-semibold">STEP {step + 1} OF {STEPS.length}</div>
        <h1 className="mt-1 font-headline font-bold text-2xl tracking-tight text-primary text-balance">
          Welcome, {firstName}. Two minutes of setup, then a baseline.
        </h1>
        <p className="mt-1.5 text-[14.5px] text-secondary">Your answers set your weekly targets and tell the coach where to start.</p>
        <div className="mt-3 md:hidden h-1.5 rounded-full bg-surface-container" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-on-tertiary-container transition-[width]" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      <div className="no-line-card flex flex-col md:flex-row min-h-[440px]">
        <nav aria-label="Setup steps" className="hidden md:flex flex-col gap-1 w-[220px] shrink-0 border-r border-outline-variant/20 p-4">
          {STEPS.map((label, i) => {
            const done = i < step;
            return (
              <button
                key={label}
                type="button"
                // Only steps already reached are jumpable; you can't skip ahead past unanswered required steps.
                disabled={i > step}
                onClick={() => set({ step: i })}
                aria-current={i === step ? 'step' : undefined}
                className={cn('flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition disabled:cursor-default', i === step && 'bg-on-tertiary-container/10')}
              >
                <span className={cn(
                  'w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11.5px] font-bold',
                  done ? 'bg-on-tertiary-container text-white' : i === step ? 'bg-primary text-white' : 'bg-surface-container text-secondary',
                )}>
                  {done ? <Check className="w-3 h-3" strokeWidth={3.5} /> : i + 1}
                </span>
                <span className={cn('text-sm font-semibold', i <= step ? 'text-primary' : 'text-secondary/70')}>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 p-5 md:p-8 flex flex-col">
          <div className="flex-1">
            {step === 0 && (
              <>
                <h2 className={heading}>Which roles are you interviewing for?</h2>
                <p className={sub}>Pick all that apply. Sets the case mix and the bar we score you against.</p>
                <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Target roles">
                  {ONBOARDING_OPTIONS.roles.map((r) => {
                    const on = draft.roles.includes(r);
                    return <button key={r} type="button" aria-pressed={on} onClick={() => toggleRole(r)} className={cn(pill(on), 'px-4 py-2.5')}>{r}</button>;
                  })}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className={heading}>Which companies are you targeting?</h2>
                <p className={sub}>Pick as many as apply, or skip. Company-specific rounds unlock for these.</p>
                <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Target companies">
                  {ONBOARDING_OPTIONS.companies.map((c) => {
                    const on = draft.companies.includes(c);
                    return <button key={c} type="button" aria-pressed={on} onClick={() => toggleCompany(c)} className={cn(pill(on), 'px-3.5 py-2 text-[13.5px]')}>{c}</button>;
                  })}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className={heading}>When do your interviews start?</h2>
                <p className={sub}>A shorter runway means higher weekly targets.</p>
                <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5" role="group" aria-label="Interview timeline">
                  {ONBOARDING_OPTIONS.timelines.map((t) => (
                    <button key={t} type="button" aria-pressed={draft.timeline === t} onClick={() => set({ timeline: t })}
                      className={cn('rounded-xl border p-4 text-left text-[15px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
                        draft.timeline === t ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-primary border-outline-variant/60 hover:border-primary/50')}>
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className={heading}>How comfortable are you with each type today?</h2>
                <p className={sub}>1 = never tried, 5 = confident. Your lowest types get prep first.</p>
                <div className="mt-5 space-y-2.5">
                  {overview.types.map((t) => (
                    <div key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <div className="basis-40 text-sm font-semibold text-primary">{t.label}</div>
                      <div className="flex gap-1.5" role="group" aria-label={`${t.label} comfort`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" aria-pressed={comfortOf(t.key) === n} aria-label={`${n} out of 5`}
                            onClick={() => set({ comfort: { ...draft.comfort, [t.key]: n } })}
                            className={cn(pill(comfortOf(t.key) === n), 'w-10 h-9 !rounded-lg text-sm font-bold')}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 className={heading}>Your starting plan</h2>
                <p className={sub}>{rolesSummary}, {companySummary}, interviews in {draft.timeline.toLowerCase()}.</p>
                <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
                  <div className="rounded-xl border border-outline-variant/30 p-4">
                    <div className="label-blueprint font-semibold">PREP TARGET</div>
                    <div className="mt-1.5 font-headline font-extrabold text-[22px] text-primary">{targets.prep} <span className="text-[13px] font-medium text-secondary">lessons / week</span></div>
                  </div>
                  <div className="rounded-xl border border-outline-variant/30 p-4">
                    <div className="label-blueprint font-semibold">INTERVIEW TARGET</div>
                    <div className="mt-1.5 font-headline font-extrabold text-[22px] text-primary">{targets.interviews} <span className="text-[13px] font-medium text-secondary">interviews / week</span></div>
                  </div>
                </div>
                <p className="mt-2 text-[12.5px] text-secondary">You can change these any time from the dashboard.</p>

                <div className="mt-6 text-sm font-bold text-primary">How do you want to start?</div>
                <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
                  <button type="button" disabled={saving} onClick={() => setBaselineOpen(true)}
                    className="text-left rounded-xl border-[1.5px] border-on-tertiary-container bg-on-tertiary-container/[0.06] p-[18px] flex flex-col gap-1.5 hover:bg-on-tertiary-container/10 transition disabled:opacity-60">
                    <span className="label-blueprint !text-on-tertiary-container font-bold">RECOMMENDED</span>
                    <span className="font-headline font-bold text-base text-primary">Take a {BASELINE_MINUTES}-minute baseline interview</span>
                    <span className="text-[13.5px] text-secondary leading-relaxed">One short case and two resume questions. Gives you a real starting score for each type.</span>
                  </button>
                  <button type="button" disabled={saving} onClick={startPrep}
                    className="text-left rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-[18px] flex flex-col gap-1.5 hover:border-primary/40 transition disabled:opacity-60">
                    <span className="label-blueprint font-bold">OR START WITH PREP</span>
                    <span className="font-headline font-bold text-base text-primary">{firstLesson ? `${lowest.label}: ${firstLesson.title}` : 'Browse the lessons'}</span>
                    <span className="text-[13.5px] text-secondary leading-relaxed">Starts with your lowest-rated type.{firstLesson ? ` About ${firstLesson.minutes} minutes.` : ''}</span>
                  </button>
                </div>
                {saving && <p className="mt-3 text-[13px] text-secondary inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving your plan…</p>}
                {error && <p role="alert" className="mt-3 text-[13px] text-error">{error}</p>}
              </>
            )}
          </div>

          <div className="flex items-center justify-between mt-6">
            <button type="button" onClick={() => set({ step: Math.max(0, step - 1) })} className={cn('text-sm font-semibold text-secondary hover:text-primary', step === 0 && 'invisible')}>Back</button>
            {step < LAST && (
              <button type="button" disabled={!canContinue} onClick={() => set({ step: step + 1 })}
                className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed">
                Continue
              </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {baselineOpen && (
          <PreInterviewCheck
            key="baseline"
            overview={overview}
            target="baseline"
            busy={saving}
            onClose={() => setBaselineOpen(false)}
            onStart={startBaseline}
            onPrep={() => undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
