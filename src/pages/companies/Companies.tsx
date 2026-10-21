import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Search, ArrowRight } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { companies, COMPANY_CATEGORIES, monogram, type CompanyCategory } from '@/src/data/companies';

export default function Companies() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CompanyCategory | 'All'>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies.filter(
      (c) => (category === 'All' || c.category === category) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [query, category]);

  return (
    <div className="space-y-5 py-1">
      {/* Hero */}
      <div className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(150deg,#08aae4,#002046)' }}>
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(255,255,255,.16),transparent 70%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2 label-blueprint text-white/60 mb-1.5"><Building2 className="w-3.5 h-3.5" /> Company-specific</div>
          <h1 className="font-headline font-extrabold text-xl md:text-2xl leading-tight max-w-2xl">Every firm interviews differently. Practise for the one you actually want.</h1>
          <p className="text-white/75 text-[13px] mt-1.5 max-w-2xl leading-relaxed">
            Pick a company to see its interview rounds and prep. Content is rolling out firm by firm.
          </p>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3 focus-within:border-on-tertiary-container transition md:w-72">
          <Search className="w-4 h-4 text-secondary shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a company"
            aria-label="Find a company"
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-primary placeholder:text-outline py-2.5"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrolling-log pb-1 md:pb-0">
          {(['All', ...COMPANY_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-[13px] font-bold whitespace-nowrap transition',
                category === cat
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-secondary hover:text-primary',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="no-line-card p-10 text-center">
          <p className="font-headline font-bold text-primary">No company matches &ldquo;{query}&rdquo;.</p>
          <p className="text-secondary text-sm mt-1">Check the spelling, or clear the filter.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              to={`/companies/${c.id}`}
              className="no-line-card p-4 flex flex-col gap-3 hover:shadow-lg hover:-translate-y-0.5 hover:border-on-tertiary-container/40 transition group"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-lg bg-primary text-on-primary flex items-center justify-center font-headline font-extrabold text-sm shrink-0">
                  {monogram(c.name)}
                </span>
                <div className="min-w-0">
                  <h2 className="font-headline font-bold text-[15px] text-primary truncate">{c.name}</h2>
                  <span className="label-blueprint text-on-tertiary-container">{c.category}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-secondary group-hover:text-on-tertiary-container group-hover:translate-x-0.5 transition ml-auto shrink-0" />
              </div>
              <p className="text-[12.5px] text-secondary leading-relaxed line-clamp-2">{c.blurb}</p>
              <div className="flex items-center justify-between mt-auto">
                <span className="text-[11px] text-secondary/70">
                  {c.availableInterviewTypes.length} interview type{c.availableInterviewTypes.length === 1 ? '' : 's'}
                </span>
                {!c.prepAvailable && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded">Prep soon</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
