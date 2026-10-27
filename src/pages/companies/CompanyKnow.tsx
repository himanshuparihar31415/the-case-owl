import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Info } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { INTERVIEW_TYPES } from '@/src/data/companies';
import { CHECKLIST, STAGE_GUIDES } from '@/src/data/companyPrep';
import { toggle } from '@/src/lib/companyProgress';
import { useCompanyHub } from './CompanyLayout';

const SECTIONS = [
  ['What happens', 'what'],
  ['What to expect', 'expect'],
  ['Skills assessed', 'skills'],
  ['How to prepare', 'prepare'],
] as const;

export default function CompanyKnow() {
  const { company, progress, update } = useCompanyHub();
  const [open, setOpen] = useState<string | null>(company.availableInterviewTypes[0] ?? null);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-headline font-extrabold text-xl text-primary">Know the {company.name} interview</h2>
        <p className="text-secondary text-sm mt-1">The formats {company.name} is listed with, and how to get ready for each.</p>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-tertiary-fixed/50 px-4 py-3 text-[13px] text-on-tertiary-fixed-variant leading-relaxed">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          <strong>General guidance, not verified for {company.name}.</strong> We haven&apos;t confirmed {company.name}&apos;s
          exact rounds, their order or their length. Check the firm&apos;s own careers page for the current process.
        </p>
      </div>

      <section aria-label="Interview roadmap" className="space-y-2">
        {company.availableInterviewTypes.map((t, i) => {
          const guide = STAGE_GUIDES[t];
          const isOpen = open === t;
          return (
            <div key={t} className="no-line-card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : t)}
                aria-expanded={isOpen}
                aria-controls={`stage-${t}`}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-tertiary-container/50"
              >
                <span className="w-7 h-7 rounded-full bg-primary text-on-primary text-[12px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-headline font-bold text-[15px] text-primary">{INTERVIEW_TYPES[t].label}</span>
                  <span className="block text-[12.5px] text-secondary truncate">{INTERVIEW_TYPES[t].blurb}</span>
                </span>
                <ChevronDown className={cn('w-4 h-4 text-secondary transition-transform shrink-0', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div id={`stage-${t}`} className="px-4 pb-4 pt-1 grid sm:grid-cols-2 gap-x-6 gap-y-4 border-t border-outline-variant/15">
                  {SECTIONS.map(([label, key]) => {
                    const value = guide[key];
                    return (
                      <div key={key} className={key === 'what' ? 'sm:col-span-2 pt-3' : undefined}>
                        <div className="label-blueprint text-on-tertiary-container mb-1.5">{label}</div>
                        {typeof value === 'string' ? (
                          <p className="text-[13.5px] text-on-surface-variant leading-relaxed">{value}</p>
                        ) : key === 'skills' ? (
                          <div className="flex flex-wrap gap-1.5">
                            {value.map((s) => (
                              <span key={s} className="text-[12px] font-semibold text-primary bg-surface-container-low px-2.5 py-1 rounded-md">{s}</span>
                            ))}
                          </div>
                        ) : (
                          <ul className="space-y-1.5">
                            {value.map((v) => (
                              <li key={v} className="flex items-start gap-2 text-[13px] text-on-surface-variant leading-relaxed">
                                <span className="w-1.5 h-1.5 rounded-full bg-on-tertiary-container mt-[7px] shrink-0" />{v}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="no-line-card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-headline font-bold text-base text-primary">Preparation checklist</h3>
          <span className="text-[12px] text-secondary">{progress.checklist.filter((id) => CHECKLIST.some((c) => c.id === id)).length} of {CHECKLIST.length}</span>
        </div>
        <ul className="space-y-1">
          {CHECKLIST.map((c) => {
            const done = progress.checklist.includes(c.id);
            return (
              <li key={c.id}>
                <label className="flex items-center gap-3 py-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => update((p) => ({ ...p, checklist: toggle(p.checklist, c.id) }))}
                    className="sr-only peer"
                  />
                  <span className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition peer-focus-visible:ring-2 peer-focus-visible:ring-on-tertiary-container/50',
                    done ? 'bg-on-tertiary-container border-on-tertiary-container text-white' : 'border-outline-variant group-hover:border-on-tertiary-container',
                  )}>
                    {done && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                  </span>
                  <span className={cn('text-[13.5px]', done ? 'text-secondary line-through' : 'text-on-surface')}>{c.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex justify-end">
        <Link to="../learn" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition">
          Continue to Learn <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
