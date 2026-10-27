import { Link } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, Circle, Clock, Target } from 'lucide-react';
import { lessonsFor, type Lesson, type LessonArea } from '@/src/data/companyPrep';
import { useCompanyHub } from './CompanyLayout';

const AREAS: Array<{ id: LessonArea; title: string; blurb: string; Icon: typeof Building2 }> = [
  { id: 'company', title: 'Know the company', blurb: 'Its business, relevant work, what the role expects and your “Why this company?”', Icon: Building2 },
  { id: 'skills', title: 'Build interview skills', blurb: 'Case structuring, quantitative reasoning and personal stories.', Icon: Target },
];

function Row({ lesson, done, current }: { lesson: Lesson; done: boolean; current: boolean }) {
  return (
    <Link
      to={lesson.id}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-tertiary-container/50"
    >
      {done
        ? <CheckCircle2 className="w-5 h-5 text-on-tertiary-container shrink-0" aria-label="Completed" />
        : <Circle className="w-5 h-5 text-outline-variant shrink-0" aria-label="Not completed" />}
      <span className="min-w-0 flex-1">
        <span className="block font-headline font-bold text-[14px] text-primary">{lesson.title}</span>
        <span className="block text-[12.5px] text-secondary truncate">{lesson.summary}</span>
      </span>
      {current && <span className="text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded shrink-0">Resume</span>}
      <span className="hidden sm:inline-flex items-center gap-1 text-[12px] text-secondary shrink-0"><Clock className="w-3.5 h-3.5" />{lesson.minutes} min</span>
      <ArrowRight className="w-4 h-4 text-secondary shrink-0" />
    </Link>
  );
}

export default function CompanyLearn() {
  const { company, progress } = useCompanyHub();
  const lessons = lessonsFor(company);
  const resume = lessons.find((l) => l.id === progress.lastLesson && !progress.lessonsDone.includes(l.id));
  const next = resume ?? lessons.find((l) => !progress.lessonsDone.includes(l.id));
  const doneCount = lessons.filter((l) => progress.lessonsDone.includes(l.id)).length;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-headline font-extrabold text-xl text-primary">Learn about {company.name} and build your skills</h2>
          <p className="text-secondary text-sm mt-1">{doneCount} of {lessons.length} lessons complete. Open any lesson in any order.</p>
        </div>
        {next && (
          <Link to={next.id} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition">
            {resume ? 'Resume' : doneCount ? 'Next lesson' : 'Start'}: {next.title} <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {AREAS.map(({ id, title, blurb, Icon }) => (
        <section key={id} className="no-line-card overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-4 border-b border-outline-variant/15">
            <span className="w-9 h-9 rounded-lg bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px]" /></span>
            <div>
              <h3 className="font-headline font-bold text-base text-primary">{title}</h3>
              <p className="text-[12.5px] text-secondary">{blurb}</p>
            </div>
          </div>
          <div className="divide-y divide-outline-variant/15">
            {lessons.filter((l) => l.area === id).map((l) => (
              <Row key={l.id} lesson={l} done={progress.lessonsDone.includes(l.id)} current={resume?.id === l.id} />
            ))}
          </div>
          {id === 'company' && (
            <p className="px-4 py-3 text-[12px] text-secondary bg-surface-container-low/60 border-t border-outline-variant/15">
              These lessons teach you how to research {company.name} yourself. We don&apos;t yet publish verified facts about the firm.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
