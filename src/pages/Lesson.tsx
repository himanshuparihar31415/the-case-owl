import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, ArrowLeft, Play, Lightbulb, Quote } from 'lucide-react';
import { api } from '@/src/lib/api';

interface Exemplar { caseType: string; skillTested: string; question: string; modelAnswer: string }
interface Lesson {
  habitTag: string; label: string; skill: string; intro: string;
  drills: string[]; exemplars: Exemplar[];
  stats: { reportsAnalyzed: number; exemplarCount: number; drillCount: number };
}

export default function Lesson() {
  const { habitTag } = useParams<{ habitTag: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!habitTag) return;
    setLoading(true); setError('');
    api.get<{ lesson: Lesson }>(`/coaching/lessons/${habitTag}`)
      .then((d) => setLesson(d.lesson))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load lesson.'))
      .finally(() => setLoading(false));
    // Record the view so the next report can close the loop. Fire-and-forget.
    api.post('/coaching/viewed', { habitTag }).catch(() => { /* non-critical */ });
  }, [habitTag]);

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }
  if (error || !lesson) {
    return (
      <div className="py-20 text-center space-y-4 max-w-md mx-auto">
        <p className="text-secondary">{error || 'Lesson not found.'}</p>
        <Link to="/learn" className="inline-flex items-center gap-2 text-on-tertiary-container font-semibold text-sm hover:underline"><ArrowLeft className="w-4 h-4" /> Back to lessons</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2 max-w-3xl">
      <Link to="/learn" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-primary transition"><ArrowLeft className="w-4 h-4" /> Focus lessons</Link>

      {/* Header */}
      <div>
        <div className="label-blueprint text-on-tertiary-container mb-1">{lesson.skill} · 2-min read</div>
        <h1 className="font-headline font-bold text-2xl text-primary leading-tight">{lesson.label}</h1>
        <p className="text-secondary text-sm mt-2 leading-relaxed">{lesson.intro}</p>
      </div>

      {/* The pattern to drill */}
      {lesson.drills.length > 0 && (
        <div className="no-line-card p-5 border-l-4 border-on-tertiary-container">
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
        <p className="text-[12.5px] text-secondary mb-3">Model answers pulled from real cases on the platform.</p>
        {lesson.exemplars.length === 0 ? (
          <div className="no-line-card p-5 text-sm text-secondary leading-relaxed">
            Real examples for this habit will appear here as more sessions accumulate. In the meantime, drill the pattern above, then start a case to put it into practice.
          </div>
        ) : (
          <div className="space-y-3">
            {lesson.exemplars.map((e, i) => (
              <div key={i} className="no-line-card p-5">
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

      {/* CTA */}
      <div className="no-line-card p-5 flex items-center justify-between gap-4 flex-wrap"
        style={{ background: 'linear-gradient(160deg,#002046,#0A1B33)' }}>
        <div>
          <p className="font-headline font-bold text-white">Now put it into practice.</p>
          <p className="text-[12.5px] text-white/60 mt-0.5">The loop closes in your next report — you'll see how this changed your case.</p>
        </div>
        <Link to="/config" className="inline-flex items-center gap-2 bg-on-tertiary-container text-white rounded-xl py-2.5 px-5 font-semibold text-sm hover:brightness-110 transition shrink-0">
          Start a case <Play className="w-4 h-4 fill-current" />
        </Link>
      </div>

      {lesson.stats.reportsAnalyzed > 0 && (
        <p className="text-[11px] text-secondary/60 text-center">Drawn from {lesson.stats.reportsAnalyzed} recent evaluations across the platform.</p>
      )}
    </div>
  );
}
