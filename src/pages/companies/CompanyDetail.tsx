import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Mic, Clock } from 'lucide-react';
import { getCompany, INTERVIEW_TYPES, monogram } from '@/src/data/companies';

function SoonBadge({ label = 'Coming soon' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded">
      <Clock className="w-3 h-3" /> {label}
    </span>
  );
}

export default function CompanyDetail() {
  const { companyId } = useParams();
  const company = getCompany(companyId);

  if (!company) {
    return (
      <div className="py-20 text-center space-y-4 max-w-md mx-auto">
        <h1 className="font-headline font-extrabold text-xl text-primary">We don&apos;t have that company.</h1>
        <p className="text-secondary text-sm">It may have moved, or it isn&apos;t on the list yet.</p>
        <Link to="/companies" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition">
          <ArrowLeft className="w-4 h-4" /> All companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-1">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-primary transition">
        <ArrowLeft className="w-4 h-4" /> All companies
      </Link>

      {/* Header */}
      <header className="no-line-card p-5 flex items-center gap-4">
        <span className="w-14 h-14 rounded-xl bg-primary text-on-primary flex items-center justify-center font-headline font-extrabold text-lg shrink-0">
          {monogram(company.name)}
        </span>
        <div className="min-w-0">
          <span className="label-blueprint text-on-tertiary-container">{company.category}</span>
          <h1 className="font-headline font-extrabold text-2xl text-primary leading-tight">{company.name}</h1>
          <p className="text-secondary text-sm mt-1 max-w-2xl">{company.blurb}</p>
        </div>
      </header>

      {/* Interview */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Mic className="w-4 h-4 text-on-tertiary-container" />
          <h2 className="font-headline font-bold text-base text-primary">Interview</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {company.availableInterviewTypes.map((t) => (
            <div key={t} className="no-line-card p-4 flex flex-col gap-3">
              <div>
                <h3 className="font-headline font-bold text-[14px] text-primary">{INTERVIEW_TYPES[t].label}</h3>
                <p className="text-[12.5px] text-secondary leading-relaxed mt-0.5">{INTERVIEW_TYPES[t].blurb}</p>
              </div>
              <div className="flex items-center justify-between mt-auto">
                <SoonBadge />
                <button
                  type="button"
                  disabled
                  className="px-4 py-2 bg-primary text-on-primary font-headline font-bold rounded-lg text-[13px] opacity-40 cursor-not-allowed"
                >
                  Start
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Preparation */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-on-tertiary-container" />
          <h2 className="font-headline font-bold text-base text-primary">Preparation</h2>
        </div>
        <div className="no-line-card p-6 text-center space-y-2">
          <SoonBadge />
          <p className="font-headline font-bold text-primary">{company.name} prep is being written.</p>
          <p className="text-secondary text-[13px] max-w-md mx-auto">
            Round-by-round format, what they screen for, and the mistakes people keep making. In the meantime, the general frameworks apply.
          </p>
          <Link
            to="/learn"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-tertiary-container hover:underline"
          >
            Browse general preparation →
          </Link>
        </div>
      </section>
    </div>
  );
}
