import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowRight, GraduationCap, Target, Compass, BookOpen, ExternalLink } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';

interface Framework { name: string; idea: string }
interface LessonMeta { habitTag: string; label: string; skill: string; intro: string; yourCount: number }
interface Resource { label: string; detail: string; url: string }
interface Index {
  module: string;
  modules: Array<{ id: string; label: string; blurb: string }>;
  frameworks: Framework[];
  lessons: LessonMeta[];
  topHabit: string | null;
  resources: Resource[];
}

export default function Learn() {
  const [params, setParams] = useSearchParams();
  const module = params.get('m') || 'case';
  const [data, setData] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Index>(`/coaching/lessons?module=${module}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [module]);

  const activeModule = data?.modules.find((m) => m.id === module);

  return (
    <div className="space-y-5 py-1">
      {/* Hero */}
      <div className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(150deg,#08aae4,#002046)' }}>
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(255,255,255,.16),transparent 70%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2 label-blueprint text-white/60 mb-1.5"><GraduationCap className="w-3.5 h-3.5" /> Focus lessons</div>
          <h1 className="font-headline font-extrabold text-xl md:text-2xl leading-tight max-w-2xl">Frameworks, model answers, and drills — 2 minutes each.</h1>
          <p className="text-white/75 text-[13px] mt-1.5 max-w-2xl leading-relaxed">
            Pick your track, learn the framework, read real model answers from actual cases, then run a case. Everything below adapts to the category you choose.
          </p>
        </div>
      </div>

      {/* Category switch */}
      <div>
        <div className="inline-flex bg-surface-container-low rounded-xl p-1 gap-1 flex-wrap">
          {(data?.modules ?? [{ id: 'case', label: 'Consulting', blurb: '' }, { id: 'product', label: 'Product', blurb: '' }, { id: 'guesstimate', label: 'Guesstimate', blurb: '' }]).map((m) => (
            <button key={m.id} onClick={() => setParams({ m: m.id })}
              className={cn('flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition',
                module === m.id ? 'bg-surface-container-lowest text-primary shadow-sm ring-1 ring-outline-variant/15' : 'text-secondary hover:text-primary')}>
              {m.label}
            </button>
          ))}
        </div>
        {activeModule?.blurb && <p className="text-[13px] text-secondary mt-2">{activeModule.blurb}</p>}
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>
      ) : (
        <>
          {/* Frameworks for this category */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Compass className="w-4 h-4 text-on-tertiary-container" />
              <h2 className="font-headline font-bold text-base text-primary">Frameworks for {activeModule?.label ?? 'this track'}</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.frameworks.map((f, i) => (
                <div key={i} className="no-line-card p-4 hover:shadow-md transition">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="w-7 h-7 rounded-lg bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center font-headline font-bold text-xs shrink-0">{i + 1}</span>
                    <h3 className="font-headline font-bold text-[14px] text-primary">{f.name}</h3>
                  </div>
                  <p className="text-[12.5px] text-secondary leading-relaxed">{f.idea}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Lessons by habit */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-on-tertiary-container" />
              <h2 className="font-headline font-bold text-base text-primary">Fix a recurring habit</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[...data.lessons].sort((a, b) =>
                (a.habitTag === data.topHabit ? -1 : 0) - (b.habitTag === data.topHabit ? -1 : 0) || b.yourCount - a.yourCount
              ).map((l) => {
                const isTop = l.habitTag === data.topHabit;
                return (
                  <Link key={l.habitTag} to={`/lesson/${l.habitTag}?m=${module}`}
                    className={cn('no-line-card p-5 flex flex-col gap-2 hover:shadow-lg hover:-translate-y-0.5 transition group',
                      isTop && 'ring-1 ring-error/30')}>
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
                      <span className="text-[11px] text-secondary/70">{l.yourCount > 0 ? `Flagged ${l.yourCount}× in your ${activeModule?.label ?? ''} sessions` : 'Not yet flagged here'}</span>
                      <ArrowRight className="w-4 h-4 text-secondary group-hover:text-on-tertiary-container group-hover:translate-x-0.5 transition" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Further reading */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-on-tertiary-container" />
              <h2 className="font-headline font-bold text-base text-primary">Further reading</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {data.resources.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                  className="no-line-card p-4 flex items-start gap-3 hover:shadow-md hover:border-on-tertiary-container/40 transition group">
                  <ExternalLink className="w-4 h-4 text-on-tertiary-container shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-headline font-bold text-[13.5px] text-primary group-hover:text-on-tertiary-container transition">{r.label}</h3>
                    <p className="text-[12px] text-secondary leading-snug mt-0.5">{r.detail}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
