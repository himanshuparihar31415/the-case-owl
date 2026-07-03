import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowRight, GraduationCap, Target } from 'lucide-react';
import { api } from '@/src/lib/api';

interface LessonMeta { habitTag: string; label: string; skill: string; intro: string; yourCount: number }

export default function Learn() {
  const [lessons, setLessons] = useState<LessonMeta[]>([]);
  const [topHabit, setTopHabit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ lessons: LessonMeta[]; topHabit: string | null }>('/coaching/lessons')
      .then((d) => { setLessons(d.lessons); setTopHabit(d.topHabit); })
      .catch(() => { /* keep empty */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }

  // Surface the user's bottleneck lesson first.
  const sorted = [...lessons].sort((a, b) =>
    (a.habitTag === topHabit ? -1 : 0) - (b.habitTag === topHabit ? -1 : 0) || b.yourCount - a.yourCount);

  return (
    <div className="space-y-6 py-2">
      <div>
        <div className="flex items-center gap-2 label-blueprint mb-1">
          <GraduationCap className="w-3.5 h-3.5 text-on-tertiary-container" /> Focus lessons
        </div>
        <h1 className="font-headline font-bold text-xl text-primary leading-tight">2-minute lessons, before your next case.</h1>
        <p className="text-secondary text-sm mt-1 max-w-2xl leading-relaxed">
          Each lesson shows real model answers pulled from cases across the platform for one recurring habit — the framework, the move, and why it worked. Read one, then start a case.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {sorted.map((l) => {
          const isTop = l.habitTag === topHabit;
          return (
            <Link key={l.habitTag} to={`/lesson/${l.habitTag}`}
              className="no-line-card p-5 flex flex-col gap-2 hover:shadow-lg hover:border-on-tertiary-container/40 transition group">
              <div className="flex items-center justify-between">
                <span className="label-blueprint text-on-tertiary-container">{l.skill}</span>
                {isTop && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-error bg-error-container/60 px-2 py-0.5 rounded">
                    <Target className="w-3 h-3" /> Your bottleneck
                  </span>
                )}
              </div>
              <h3 className="font-headline font-bold text-base text-primary">{l.label}</h3>
              <p className="text-[13px] text-secondary leading-relaxed line-clamp-3">{l.intro}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-secondary/70">{l.yourCount > 0 ? `Flagged ${l.yourCount}× in your sessions` : 'Not yet flagged for you'}</span>
                <ArrowRight className="w-4 h-4 text-secondary group-hover:text-on-tertiary-container group-hover:translate-x-0.5 transition" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
