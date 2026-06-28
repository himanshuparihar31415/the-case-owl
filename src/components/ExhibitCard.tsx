import React from 'react';
import { BarChart3 } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { cn } from '@/src/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const EXHIBIT_COLORS = ['#002046', '#08aae4', '#ba1a1a', '#1FA971', '#E0922F'];

// A case exhibit — a recharts line/bar when the generator gave structured
// chartData, otherwise the readable data string as a table-ish block. Shared by
// the live Session brief and the post-interview report's full-case view.
export function ExhibitCard({ ex, large = false }: { ex: any; large?: boolean }) {
  const isChart = ex.render === 'chart' && Array.isArray(ex.chartData) && ex.chartData.length > 0;
  const xKey = ex.xKey || 'x';
  const series: Array<{ key: string; label?: string }> = isChart
    ? (Array.isArray(ex.series) && ex.series.length
        ? ex.series
        : Object.keys(ex.chartData[0]).filter((k) => k !== xKey).map((k) => ({ key: k })))
    : [];
  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className={cn('text-on-tertiary-container shrink-0', large ? 'w-4 h-4' : 'w-3.5 h-3.5')} />
        <span className={cn('font-bold text-primary', large ? 'text-sm' : 'text-xs')}>{ex.label || `Exhibit ${ex.id ?? ''}`}</span>
      </div>
      {isChart ? (
        <>
          <ResponsiveContainer width="100%" height={large ? 300 : 170}>
            {ex.chartType === 'bar' ? (
              <BarChart data={ex.chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 6px 18px rgba(11,31,58,.12)' }} />
                {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label || s.key} fill={EXHIBIT_COLORS[i % EXHIBIT_COLORS.length]} radius={[2, 2, 0, 0]} />)}
              </BarChart>
            ) : (
              <LineChart data={ex.chartData} margin={{ top: 4, right: 6, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 6px 18px rgba(11,31,58,.12)' }} />
                {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key} stroke={EXHIBIT_COLORS[i % EXHIBIT_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            )}
          </ResponsiveContainer>
          {series.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              {series.map((s, i) => (
                <span key={s.key} className="flex items-center gap-1 text-[10px] text-secondary">
                  <i className="w-2 h-2 rounded-full" style={{ background: EXHIBIT_COLORS[i % EXHIBIT_COLORS.length] }} />{s.label || s.key}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-on-surface-variant whitespace-pre-line font-mono leading-relaxed">{ex.data}</p>
      )}
    </div>
  );
}
