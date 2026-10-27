import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Lightbulb, Mic, XCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { INTERVIEW_TYPES } from '@/src/data/companies';
import { lessonsFor } from '@/src/data/companyPrep';
import { useCompanyHub } from './CompanyLayout';

export default function CompanyLesson() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const { company, progress, update } = useCompanyHub();
  const lessons = lessonsFor(company);
  const index = lessons.findIndex((l) => l.id === lessonId);
  const lesson = lessons[index];
  const next = lessons[index + 1];
  const [picked, setPicked] = useState<number | null>(null);

  // A new lesson starts with a fresh knowledge check, and becomes the one to resume.
  useEffect(() => {
    setPicked(null);
    if (lessonId && index >= 0) update((p) => (p.lastLesson === lessonId ? p : { ...p, lastLesson: lessonId }));
  }, [lessonId, index, update]);

  if (!lesson) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-secondary text-sm">That lesson doesn&apos;t exist.</p>
        <Link to=".." relative="path" className="inline-flex items-center gap-1.5 text-on-tertiary-container font-semibold text-sm hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to lessons
        </Link>
      </div>
    );
  }

  const done = progress.lessonsDone.includes(lesson.id);
  const chosen = picked === null ? null : lesson.check.options[picked];

  const finish = () => {
    update((p) => ({
      ...p,
      lessonsDone: p.lessonsDone.includes(lesson.id) ? p.lessonsDone : [...p.lessonsDone, lesson.id],
      lastLesson: next ? next.id : undefined,
    }));
    navigate(next ? `../learn/${next.id}` : '../learn');
  };

  return (
    <article className="space-y-5 max-w-3xl">
      <Link to="../learn" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-primary transition">
        <ArrowLeft className="w-4 h-4" /> All lessons
      </Link>

      <header>
        <div className="label-blueprint text-on-tertiary-container mb-1 flex items-center gap-2">
          {lesson.area === 'company' ? 'Know the company' : 'Build interview skills'}
          <span className="inline-flex items-center gap-1 text-secondary"><Clock className="w-3 h-3" />{lesson.minutes} min</span>
          {done && <span className="inline-flex items-center gap-1 text-on-tertiary-container"><CheckCircle2 className="w-3 h-3" />Completed</span>}
        </div>
        <h2 className="font-headline font-extrabold text-xl text-primary leading-tight">{lesson.title}</h2>
      </header>

      <div className="space-y-3">
        {lesson.body.map((p) => (
          <p key={p} className="text-[14px] text-on-surface-variant leading-relaxed">{p}</p>
        ))}
      </div>

      <div className="no-line-card p-4 flex gap-3">
        <Lightbulb className="w-5 h-5 text-on-tertiary-container shrink-0 mt-0.5" />
        <div>
          <div className="label-blueprint text-on-tertiary-container mb-1">Example · {lesson.example.title}</div>
          <p className="text-[13.5px] text-on-surface-variant leading-relaxed">{lesson.example.text}</p>
        </div>
      </div>

      {lesson.draftPrompt && (
        <div>
          <label htmlFor="draft" className="label-blueprint mb-1.5 block">Your draft</label>
          <textarea
            id="draft"
            rows={5}
            value={progress.drafts[lesson.id] ?? ''}
            onChange={(e) => update((p) => ({ ...p, drafts: { ...p.drafts, [lesson.id]: e.target.value } }))}
            placeholder={lesson.draftPrompt}
            className="w-full bg-surface-container-lowest border border-outline-variant/25 rounded-xl px-3.5 py-3 text-sm text-primary placeholder:text-outline focus:outline-none focus:border-on-tertiary-container transition resize-y"
          />
        </div>
      )}

      <section className="no-line-card p-5" aria-labelledby="check-q">
        <div className="label-blueprint text-on-tertiary-container mb-1.5">Knowledge check</div>
        <h3 id="check-q" className="font-headline font-bold text-[15px] text-primary mb-3">{lesson.check.question}</h3>
        <div className="space-y-2" role="radiogroup" aria-labelledby="check-q">
          {lesson.check.options.map((o, i) => {
            const isPicked = picked === i;
            return (
              <button
                key={o.text}
                type="button"
                role="radio"
                aria-checked={isPicked}
                onClick={() => setPicked(i)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-lg border text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50',
                  !isPicked && 'border-outline-variant/30 text-on-surface hover:border-on-tertiary-container/50',
                  isPicked && o.correct && 'border-on-tertiary-container bg-on-tertiary-container/10 text-primary',
                  isPicked && !o.correct && 'border-error/50 bg-error-container/40 text-primary',
                )}
              >
                {o.text}
              </button>
            );
          })}
        </div>
        {chosen && (
          <div role="status" className={cn('mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed', chosen.correct ? 'text-on-tertiary-fixed-variant' : 'text-on-error-container')}>
            {chosen.correct ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <p><strong>{chosen.correct ? 'Correct. ' : 'Not quite. '}</strong>{chosen.feedback}</p>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`../mock?type=${lesson.mockType}`} className="inline-flex items-center gap-2 text-[13px] font-bold text-on-tertiary-container hover:underline">
          <Mic className="w-4 h-4" /> Practise this in a {INTERVIEW_TYPES[lesson.mockType].label.toLowerCase()} mock
        </Link>
        <button
          type="button"
          onClick={finish}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition"
        >
          {next ? `${done ? 'Next lesson' : 'Complete and continue'}` : 'Complete and finish'} <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
}
