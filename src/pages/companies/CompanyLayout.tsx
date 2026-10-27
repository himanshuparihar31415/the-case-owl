import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { getCompany, monogram, type Company } from '@/src/data/companies';
import { useCompanyProgress, type CompanyProgress, type UpdateProgress } from '@/src/lib/companyProgress';

export interface CompanyHub {
  company: Company;
  progress: CompanyProgress;
  update: UpdateProgress;
}

export const useCompanyHub = () => useOutletContext<CompanyHub>();

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'know', label: '01 · Know' },
  { to: 'learn', label: '02 · Learn' },
  { to: 'mock', label: '03 · Mock' },
];

function NotFound() {
  return (
    <div className="py-20 text-center space-y-4 max-w-md mx-auto">
      <h1 className="font-headline font-extrabold text-xl text-primary">We don&apos;t have that company.</h1>
      <p className="text-secondary text-sm">It may have moved, or it isn&apos;t on the list yet.</p>
      <Link to="/companies" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition">
        <ArrowLeft className="w-4 h-4" /> Back to companies
      </Link>
    </div>
  );
}

/** Shared frame for a company: identity and tabs stay put while Overview / Know / Learn / Mock swap below. */
function Hub({ company }: { company: Company }) {
  const [progress, update] = useCompanyProgress(company.id);

  return (
    <div className="space-y-5 py-1">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-primary transition">
        <ArrowLeft className="w-4 h-4" /> Back to companies
      </Link>

      <header className="flex items-center gap-3.5">
        <span className="w-12 h-12 rounded-xl bg-primary text-on-primary flex items-center justify-center font-headline font-extrabold text-base shrink-0">
          {monogram(company.name)}
        </span>
        <div className="min-w-0">
          <span className="label-blueprint text-on-tertiary-container">{company.category}</span>
          <h1 className="font-headline font-extrabold text-2xl text-primary leading-tight truncate">{company.name}</h1>
        </div>
      </header>

      <nav aria-label={`${company.name} preparation`} className="border-b border-outline-variant/25 flex gap-1 overflow-x-auto scrolling-log">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) => cn(
              'relative px-4 py-3 text-[14px] font-headline font-bold whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50 rounded-t',
              isActive ? 'text-primary' : 'text-secondary hover:text-primary',
            )}
          >
            {({ isActive }) => (
              <>
                {t.label}
                {isActive && <span className="absolute left-3 right-3 -bottom-px h-[3px] rounded-full bg-on-tertiary-container" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ company, progress, update } satisfies CompanyHub} />
    </div>
  );
}

export default function CompanyLayout() {
  const { companyId } = useParams();
  const company = getCompany(companyId);
  return company ? <Hub key={company.id} company={company} /> : <NotFound />;
}
