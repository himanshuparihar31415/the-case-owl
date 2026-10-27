import { Link } from 'react-router-dom';
import { ArrowRight, Compass, GraduationCap, Mic } from 'lucide-react';
import { CHECKLIST, lessonsFor } from '@/src/data/companyPrep';
import { useCompanyHub } from './CompanyLayout';

export default function CompanyOverview() {
  const { company, progress } = useCompanyHub();
  const lessons = lessonsFor(company);
  const doneLessons = progress.lessonsDone.filter((id) => lessons.some((l) => l.id === id)).length;
  const doneChecks = progress.checklist.filter((id) => CHECKLIST.some((c) => c.id === id)).length;
  const resume = lessons.find((l) => l.id === progress.lastLesson && !progress.lessonsDone.includes(l.id));

  const status = (done: number, total: number, started: boolean) =>
    done >= total ? 'Complete' : started || done > 0 ? `${done} of ${total} done` : 'Not started';

  const cards = [
    {
      to: 'know', step: '01', title: 'Know', Icon: Compass,
      text: `Understand the interview formats ${company.name} is listed with, what to expect and what is assessed.`,
      status: status(doneChecks, CHECKLIST.length, false), action: 'Explore the process',
    },
    {
      to: 'learn', step: '02', title: 'Learn', Icon: GraduationCap,
      text: `Learn about ${company.name} and build the skills the interviews test.`,
      status: status(doneLessons, lessons.length, false), action: resume ? 'Resume lesson' : doneLessons ? 'Keep learning' : 'Start learning',
    },
    {
      to: 'mock', step: '03', title: 'Mock', Icon: Mic,
      text: `Practise an AI interview in a format ${company.name} is listed with.`,
      status: progress.mockStarted ? 'Practice started' : 'Not started', action: 'Set up a mock',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(150deg,#08aae4,#002046)' }}>
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(255,255,255,.16),transparent 70%)' }} />
        <div className="relative">
          <h2 className="font-headline font-extrabold text-xl md:text-2xl leading-tight">Know the process. Learn the skills. Walk in prepared.</h2>
          <p className="text-white/75 text-[13px] mt-1.5 max-w-2xl leading-relaxed">{company.blurb}</p>
          <p className="text-white/60 text-[12px] mt-3">We suggest Know, then Learn, then Mock. You can start anywhere.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {cards.map(({ to, step, title, Icon, text, status: st, action }) => (
          <Link
            key={to}
            to={to}
            className="no-line-card p-5 flex flex-col gap-3 hover:shadow-lg hover:-translate-y-0.5 hover:border-on-tertiary-container/40 transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50"
          >
            <div className="flex items-center justify-between">
              <span className="w-10 h-10 rounded-lg bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </span>
              <span className="label-blueprint">{step}</span>
            </div>
            <div>
              <h3 className="font-headline font-extrabold text-lg text-primary">{title}</h3>
              <p className="text-[13px] text-secondary leading-relaxed mt-1">{text}</p>
            </div>
            <div className="flex items-center justify-between mt-auto pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded">{st}</span>
              <span className="inline-flex items-center gap-1 text-[13px] font-bold text-on-tertiary-container">
                {action} <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
