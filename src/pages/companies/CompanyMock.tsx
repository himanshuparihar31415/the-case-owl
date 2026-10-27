import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, Info, Mic, Play } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { INTERVIEW_TYPES, type InterviewTypeId } from '@/src/data/companies';
import { MOCK_MODES, MOCK_OPTIONS, type MockMode } from '@/src/data/companyPrep';
import { useCompanyHub } from './CompanyLayout';

export default function CompanyMock() {
  const { company, update } = useCompanyHub();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const types = company.availableInterviewTypes;
  const wanted = params.get('type') as InterviewTypeId | null;
  const [type, setType] = useState<InterviewTypeId>(wanted && types.includes(wanted) ? wanted : types[0]);
  const [mode, setMode] = useState<MockMode>('guided');
  const option = MOCK_OPTIONS[type];

  const start = () => {
    if (!option.start) return;
    update((p) => ({ ...p, mockStarted: true }));
    navigate(option.start.to, { state: { ...option.start.state, company: company.id, mode } });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-headline font-extrabold text-xl text-primary">Practise a {company.name} mock interview</h2>
        <p className="text-secondary text-sm mt-1">Set it up in two choices, then start.</p>
      </div>

      <section aria-labelledby="mock-type">
        <h3 id="mock-type" className="label-blueprint mb-2">1 · Interview type</h3>
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-labelledby="mock-type">
          {types.map((t) => {
            const active = type === t;
            const ready = MOCK_OPTIONS[t].start !== null;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setType(t)}
                className={cn(
                  'text-left p-4 rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
                  active ? 'border-on-tertiary-container bg-on-tertiary-container/5' : 'bg-surface-container-lowest border-outline-variant/25 hover:border-on-tertiary-container/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-headline font-bold text-[14px] text-primary">{INTERVIEW_TYPES[t].label}</span>
                  {!ready && <span className="text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded inline-flex items-center gap-1"><Clock className="w-3 h-3" />Soon</span>}
                </div>
                <p className="text-[12.5px] text-secondary mt-0.5 leading-relaxed">{INTERVIEW_TYPES[t].blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="mock-mode">
        <h3 id="mock-mode" className="label-blueprint mb-2">2 · How you want to practise</h3>
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-labelledby="mock-mode">
          {(Object.keys(MOCK_MODES) as MockMode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(m)}
                className={cn(
                  'text-left p-4 rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
                  active ? 'border-on-tertiary-container bg-on-tertiary-container/5' : 'bg-surface-container-lowest border-outline-variant/25 hover:border-on-tertiary-container/40',
                )}
              >
                <span className="font-headline font-bold text-[14px] text-primary">{MOCK_MODES[m].label}</span>
                <p className="text-[12.5px] text-secondary mt-0.5 leading-relaxed">{MOCK_MODES[m].blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="no-line-card p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="label-blueprint mb-1">Expected duration</div>
            <p className="text-[14px] font-semibold text-primary flex items-center gap-1.5"><Clock className="w-4 h-4 text-on-tertiary-container" />{option.duration}</p>
          </div>
          <div>
            <div className="label-blueprint mb-1">Response format</div>
            <p className="text-[13.5px] text-on-surface-variant leading-relaxed flex items-start gap-1.5"><Mic className="w-4 h-4 text-on-tertiary-container mt-0.5 shrink-0" />{option.format}</p>
          </div>
        </div>

        {option.start && (
          <div className="flex items-start gap-2.5 rounded-lg bg-tertiary-fixed/50 px-3.5 py-2.5 text-[12.5px] text-on-tertiary-fixed-variant leading-relaxed">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>This starts our standard {INTERVIEW_TYPES[type].label.toLowerCase()}. Scenarios tailored to {company.name} are still being built.</p>
          </div>
        )}

        <button
          type="button"
          onClick={start}
          disabled={!option.start}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-on-primary font-headline font-bold rounded-lg text-[15px] hover:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Play className="w-4 h-4" /> Start mock interview
        </button>
        {!option.start && <p className="text-[12.5px] text-secondary">This format isn&apos;t available yet. Pick another type to practise now.</p>}
      </section>
    </div>
  );
}
