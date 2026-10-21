import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Flame, Trophy, Mic, CalendarCheck, Play } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import {
  buildHeatmap, computeStreaks, countByDay, heatLevel, thisWeekCount,
  type HeatCell, type HistoryItem, type InterviewModule,
} from '@/src/lib/practice';

// light bg -> cyan -> navy
const LEVEL_COLOR = ['#E9EDF3', '#BFE6F6', '#08aae4', '#0B6DA3', '#002046'];
const DOW = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function useIsWide() {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

interface Props {
  history: HistoryItem[];
  loaded: boolean;
  module: InterviewModule;
}

export default function StreakHero({ history, loaded, module }: Props) {
  const wide = useIsWide();
  const weeks = wide ? 26 : 13;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ cell: HeatCell; x: number; y: number } | null>(null);

  const counts = useMemo(() => countByDay(history), [history]);
  const streaks = useMemo(() => computeStreaks(counts), [counts]);
  const week = useMemo(() => thisWeekCount(counts), [counts]);
  const grid = useMemo(() => buildHeatmap(counts, weeks), [counts, weeks]);
  const inWindow = useMemo(() => grid.flat().reduce((n, c) => n + c.count, 0), [grid]);
  const empty = history.length === 0;

  const showTip = (cell: HeatCell, el: HTMLElement) => {
    const wr = wrapRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!wr) return;
    setTip({ cell, x: r.left - wr.left + r.width / 2, y: r.top - wr.top });
  };

  // Month labels sit over the first column of each new month.
  const monthLabels = grid.map((col, i) => {
    const m = col[0].date.getMonth();
    const prev = i > 0 ? grid[i - 1][0].date.getMonth() : -1;
    return m !== prev && i < weeks - 1 ? col[0].date.toLocaleDateString(undefined, { month: 'short' }) : '';
  });

  const colTemplate = `28px repeat(${weeks}, minmax(0, 1fr))`;
  const nudge = empty ? null
    : streaks.activeToday ? 'Rep logged today. Come back tomorrow.'
    : streaks.current > 0 ? 'Rep today or this ends.'
    : 'Streak is cold. One rep restarts it.';

  const stats = [
    { label: 'Current streak', value: streaks.current, unit: streaks.current === 1 ? 'day' : 'days', Icon: Flame, hot: streaks.current > 0, note: nudge },
    { label: 'Longest streak', value: streaks.longest, unit: streaks.longest === 1 ? 'day' : 'days', Icon: Trophy },
    { label: 'Total interviews', value: history.length, unit: '', Icon: Mic },
    { label: 'This week', value: week, unit: '', Icon: CalendarCheck },
  ];

  return (
    <section className="no-line-card p-4 md:p-5" aria-label="Practice streak">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="label-blueprint text-on-tertiary-container mb-0.5">Your practice streak</div>
          <h2 className="font-headline font-extrabold text-lg md:text-xl text-primary leading-tight">
            {empty ? 'Zero reps logged. The grid below is waiting.' : `${inWindow} interview${inWindow === 1 ? '' : 's'} in the last ${weeks} weeks.`}
          </h2>
        </div>
        <Link to="/config" state={{ module }} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-headline font-bold rounded-lg text-[13px] hover:scale-[0.98] transition">
          {empty ? 'Start your first rep' : 'Log a rep'} <Play className="w-3.5 h-3.5 fill-current" />
        </Link>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: i * 0.05 }}
            className="rounded-xl bg-surface-container-low px-3.5 py-3"
          >
            <div className="flex items-center gap-1.5 label-blueprint">
              <s.Icon className={cn('w-3.5 h-3.5', s.hot ? 'text-[#CF7C20]' : 'text-on-tertiary-container')} fill={s.hot ? '#CF7C20' : 'none'} />
              {s.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={cn('font-headline font-extrabold text-3xl leading-none', s.hot ? 'text-[#CF7C20]' : 'text-primary')}>{loaded ? s.value : '–'}</span>
              {s.unit && <span className="text-[12px] text-secondary font-medium">{s.unit}</span>}
            </div>
            {s.note && <div className="text-[11px] text-secondary mt-1.5 leading-snug">{s.note}</div>}
          </motion.div>
        ))}
      </div>

      {/* Heatmap */}
      <div ref={wrapRef} className="relative" onMouseLeave={() => setTip(null)}>
        <div className={cn('transition-opacity', (empty && loaded) && 'opacity-50', !loaded && 'animate-pulse')}>
          <div className="grid gap-[3px] md:gap-1 mb-1" style={{ gridTemplateColumns: colTemplate, maxWidth: 28 + weeks * 34 }}>
            <span />
            {monthLabels.map((m, i) => (
              <span key={i} className="text-[10px] text-secondary leading-none whitespace-nowrap overflow-visible">{m}</span>
            ))}
          </div>
          <div
            role="img"
            aria-label={`Activity heatmap: ${inWindow} interviews in the last ${weeks} weeks. Current streak ${streaks.current} days.`}
            className="grid gap-[3px] md:gap-1 grid-flow-col"
            style={{ gridTemplateColumns: colTemplate, gridTemplateRows: 'repeat(7, auto)', maxWidth: 28 + weeks * 34 }}
          >
            {DOW.map((d, i) => (
              <span key={`d${i}`} className="text-[10px] text-secondary flex items-center leading-none">{d}</span>
            ))}
            {grid.map((col) => col.map((c) => (
              c.future ? <span key={c.key} aria-hidden className="aspect-square" /> : (
                <span
                  key={c.key}
                  onMouseEnter={(e) => showTip(c, e.currentTarget)}
                  onClick={(e) => showTip(c, e.currentTarget)}
                  className="aspect-square rounded-[3px] md:rounded-[4px] cursor-default transition-transform hover:scale-125 hover:ring-1 hover:ring-primary/40"
                  style={{ background: LEVEL_COLOR[heatLevel(c.count)] }}
                />
              )
            )))}
          </div>
        </div>

        {tip && (
          <div
            className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-full -mt-2 px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-[11.5px] font-medium whitespace-nowrap shadow-lg"
            style={{ left: tip.x, top: tip.y }}
          >
            <b>{tip.cell.count} interview{tip.cell.count === 1 ? '' : 's'}</b> · {fmtDay(tip.cell.date)}
          </div>
        )}

        {/* New-user state: dimmed grid + an invitation, not a blank box */}
        {empty && loaded && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-surface-container-lowest/95 rounded-xl shadow-md border border-outline-variant/20 px-5 py-4 text-center max-w-xs">
              <Flame className="w-6 h-6 text-[#CF7C20] mx-auto mb-1.5" />
              <p className="font-headline font-bold text-primary text-sm">Day 0.</p>
              <p className="text-[12.5px] text-secondary mt-0.5 leading-snug">Finish one interview and the first square lights up. Do it again tomorrow and you have a streak.</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 gap-3">
          <span className="text-[11px] text-secondary">Completed interviews, per day.</span>
          <div className="flex items-center gap-1.5 text-[10.5px] text-secondary">
            Less
            {LEVEL_COLOR.map((c) => <span key={c} className="w-3 h-3 rounded-[3px]" style={{ background: c }} />)}
            More
          </div>
        </div>
      </div>
    </section>
  );
}
