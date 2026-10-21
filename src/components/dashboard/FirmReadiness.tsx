import { Link } from 'react-router-dom';
import { Building2, Clock } from 'lucide-react';
import { companies, monogram } from '@/src/data/companies';

const FEATURED_IDS = ['mckinsey', 'bcg', 'bain', 'deloitte', 'oliver-wyman', 'amazon'];

interface Props {
  /** Overall readiness /10 and the bar firms expect /10 — both from the dashboard endpoint. null for a new user. */
  overall: number | null;
  bar: number;
}

/** A tiny ring. Empty/dashed when we have no honest per-firm number to put in it. */
function Ring({ pct }: { pct: number | null }) {
  const r = 22, C = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#E4E8EF" strokeWidth="5" strokeDasharray={pct == null ? '3 4' : undefined} />
      {pct != null && <circle cx="28" cy="28" r={r} fill="none" stroke="#08aae4" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />}
    </svg>
  );
}

export default function FirmReadiness({ overall, bar }: Props) {
  const firms = FEATURED_IDS.map((id) => companies.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const pct = overall == null ? null : Math.min(100, Math.round((overall / bar) * 100));

  return (
    <section className="no-line-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-on-tertiary-container" />
          <h2 className="font-headline font-bold text-base text-primary">Firm Readiness</h2>
        </div>
        <Link to="/companies" className="text-[12px] font-semibold text-on-tertiary-container hover:underline">All companies →</Link>
      </div>

      {/* The one number we can stand behind */}
      <div className="rounded-xl bg-surface-container-low px-3.5 py-3 mb-3">
        {pct == null ? (
          <p className="text-[12.5px] text-secondary">Finish an interview and we&apos;ll show how far you are from the bar.</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-[12px] mb-1.5">
              <span className="font-semibold text-primary">Overall, against the bar firms expect ({bar}/10)</span>
              <span className="font-mono font-semibold text-primary">{pct}%</span>
            </div>
            <div className="h-2 bg-surface-container-highest rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: pct >= 100 ? '#1C9A6A' : '#08aae4' }} />
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
        {firms.map((f) => (
          <Link key={f.id} to={`/companies/${f.id}`} className="rounded-xl border border-outline-variant/20 p-3 flex flex-col items-center text-center gap-1.5 hover:shadow-md hover:border-on-tertiary-container/40 transition">
            <div className="relative">
              <Ring pct={null} />
              <span className="absolute inset-0 flex items-center justify-center font-headline font-extrabold text-[13px] text-primary">{monogram(f.name)}</span>
            </div>
            <span className="font-headline font-bold text-[12.5px] text-primary leading-tight">{f.name}</span>
            <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-1.5 py-0.5 rounded"><Clock className="w-2.5 h-2.5" /> Soon</span>
          </Link>
        ))}
      </div>
      <p className="text-[11.5px] text-secondary mt-3">Per-firm scores need per-firm rubrics, and we won&apos;t invent them. Until then, the overall bar is the number to trust.</p>
    </section>
  );
}
