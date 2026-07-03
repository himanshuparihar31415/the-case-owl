import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, Play, Lightbulb, Quote, Compass, BookOpen, ExternalLink } from 'lucide-react';
import { api } from '@/src/lib/api';

interface Framework { name: string; idea: string }
interface Exemplar { caseType: string; skillTested: string; question: string; modelAnswer: string }
interface Resource { label: string; detail: string; url: string }
interface Lesson {
  habitTag: string; module: string; label: string; skill: string; intro: string;
  frameworks: Framework[]; drills: string[]; exemplars: Exemplar[]; resources: Resource[];
  stats: { reportsAnalyzed: number; exemplarCount: number; drillCount: number };
}

const MODULE_LABEL: Record<string, string> = { case: 'Consulting', product: 'Product', guesstimate: 'Guesstimate' };

export default function Lesson() {
  const { habitTag } = useParams<{ habitTag: string }>();
  const [params] = useSearchParams();
  const module = params.get('m') || 'case';
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!habitTag) return;
    setLoading(true); setError('');
    api.get<{ lesson: Lesson }>(`/coaching/lessons/${habitTag}?module=${module}`)
      .then((d) => setLesson(d.lesson))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load lesson.'))
      .finally(() => setLoading(false));
    // Record the view so the next report can close the loop. Fire-and-forget.
    api.post('/coaching/viewed', { habitTag }).catch(() => { /* non-critical */ });
  }, [habitTag, module]);

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }
  if (error || !lesson) {
    return (
      <div className="py-20 text-center space-y-4 max-w-md mx-auto">
        <p className="text-secondary">{error || 'Lesson not found.'}</p>
        <Link to={`/learn?m=${module}`} className="inline-flex items-center gap-2 text-on-tertiary-container font-semibold text-sm hover:underline"><ArrowLeft className="w-4 h-4" /> Back to lessons</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 py-1 max-w-3xl">
      <Link to={`/learn?m=${lesson.module}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-primary transition"><ArrowLeft className="w-4 h-4" /> {MODULE_LABEL[lesson.module] ?? 'Focus'} lessons</Link>

      {/* Header */}
      <div>
        <div className="label-blueprint text-on-tertiary-container mb-1">{MODULE_LABEL[lesson.module] ?? ''} · {lesson.skill} · 2-min read</div>
        <h1 className="font-headline font-bold text-xl text-primary leading-tight">{lesson.label}</h1>
        <p className="text-secondary text-sm mt-2 leading-relaxed">{lesson.intro}</p>
      </div>

      {/* Frameworks for this category */}
      {lesson.frameworks.length > 0 && (
        <div className="no-line-card p-4">
          <div className="flex items-center gap-2 label-blueprint text-on-tertiary-container mb-3">
            <Compass className="w-3.5 h-3.5" /> Frameworks to reach for
          </div>
          <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3">
            {lesson.frameworks.map((f, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="w-6 h-6 rounded-lg bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center font-headline font-bold text-[11px] shrink-0">{i + 1}</span>
                <div>
                  <h3 className="font-headline font-bold text-[13px] text-primary">{f.name}</h3>
                  <p className="text-[12px] text-secondary leading-snug mt-0.5">{f.idea}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The pattern to drill */}
      {lesson.drills.length > 0 && (
        <div className="no-line-card p-4 border-l-4 border-on-tertiary-container">
          <div className="flex items-center gap-2 label-blueprint text-on-tertiary-container mb-3">
            <Lightbulb className="w-3.5 h-3.5" /> The pattern to drill
          </div>
          <ul className="space-y-2.5">
            {lesson.drills.map((d, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] text-on-surface-variant leading-relaxed">
                <span className="font-headline font-bold text-on-tertiary-container shrink-0">{i + 1}</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Model exemplars pulled live from real cases */}
      <div>
        <h2 className="font-headline font-bold text-base text-primary mb-1">What good looks like</h2>
        <p className="text-[12.5px] text-secondary mb-3">Model answers pulled from real {MODULE_LABEL[lesson.module] ?? ''} cases on the platform.</p>
        {lesson.exemplars.length === 0 ? (
          <div className="no-line-card p-4 text-sm text-secondary leading-relaxed">
            Real examples for this habit will appear here as more {MODULE_LABEL[lesson.module] ?? ''} sessions accumulate. In the meantime, study the frameworks above and drill the pattern, then start a case.
          </div>
        ) : (
          <div className="space-y-3">
            {lesson.exemplars.map((e, i) => (
              <div key={i} className="no-line-card p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-on-tertiary-container/10 text-on-tertiary-container px-2 py-0.5 rounded">{e.caseType}</span>
                  <span className="text-[11px] text-secondary/70">{e.skillTested}</span>
                </div>
                {e.question && <p className="text-[12.5px] font-semibold text-primary mb-2">Q · {e.question}</p>}
                <div className="flex gap-2.5">
                  <Quote className="w-4 h-4 text-on-tertiary-container shrink-0 mt-0.5" />
                  <p className="text-[13.5px] text-on-surface-variant leading-relaxed">{e.modelAnswer}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Further reading */}
      {lesson.resources.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-on-tertiary-container" />
            <h2 className="font-headline font-bold text-base text-primary">Further reading</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {lesson.resources.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                className="no-line-card p-4 flex items-start gap-3 hover:shadow-md hover:border-on-tertiary-container/40 transition group">
                <ExternalLink className="w-4 h-4 text-on-tertiary-container shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-headline font-bold text-[13px] text-primary group-hover:text-on-tertiary-container transition">{r.label}</h3>
                  <p className="text-[12px] text-secondary leading-snug mt-0.5">{r.detail}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="no-line-card p-4 flex items-center justify-between gap-4 flex-wrap"
        style={{ background: 'linear-gradient(150deg,#08aae4,#002046)' }}>
        <div>
          <p className="font-headline font-bold text-white">Now put it into practice.</p>
          <p className="text-[12.5px] text-white/60 mt-0.5">The loop closes in your next report — you'll see how this changed your case.</p>
        </div>
        <Link to="/config" className="inline-flex items-center gap-2 bg-white text-primary rounded-xl py-2.5 px-5 font-semibold text-sm hover:brightness-95 transition shrink-0">
          Start a case <Play className="w-4 h-4 fill-current" />
        </Link>
      </div>

      {lesson.stats.reportsAnalyzed > 0 && (
        <p className="text-[11px] text-secondary/60 text-center">Examples drawn from {lesson.stats.reportsAnalyzed} recent evaluations across the platform.</p>
      )}
    </div>
  );
}
