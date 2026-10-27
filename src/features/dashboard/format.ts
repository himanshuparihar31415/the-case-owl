import { SHORT_TYPE_LABEL } from './config';
import type { TypeProgress } from './types';

/** "+0.5", "−1.5", "±0", or an em dash when there is nothing to compare against. */
export function fmtDelta(d: number | null): string {
  if (d == null) return '—';
  if (d === 0) return '±0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

export function deltaClass(d: number | null): string {
  if (d == null || d === 0) return 'text-slate-500';
  return d > 0 ? 'text-green-700' : 'text-red-700';
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const fmtTimestamp = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export const shortLabel = (t: Pick<TypeProgress, 'key' | 'label'>) => SHORT_TYPE_LABEL[t.key] ?? t.label;
