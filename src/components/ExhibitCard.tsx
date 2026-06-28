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
// Coerce a cell to a finite number, stripping $, %, commas ("$3.2B"→3.2, "72%"→72).
function toNum(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (m) { const n = parseFloat(m[0]); return Number.isFinite(n) ? n : null; }
  }
  return null;
}

export function ExhibitCard({ ex, large = false }: { ex: any; large?: boolean }) {
  const rawRows: any[] = Array.isArray(ex.chartData) ? ex.chartData : [];
  // Treat as a chart whenever there are data rows and it isn't explicitly a
  // table/spoken — tolerant of a missing/renamed `render` field.
  const hasTable = Array.isArray(ex.columns) && ex.columns.length > 0 && Array.isArray(ex.rows) && ex.rows.length > 0;
  const isChart = rawRows.length > 0 && ex.render !== 'table' && ex.render !== 'spoken' && !hasTable;

  // Pick the x-axis key (declared one if present, else first non-numeric field).
  const firstRow = rawRows[0] ?? {};
  const xKey = (ex.xKey && ex.xKey in firstRow) ? ex.xKey
    : (Object.keys(firstRow).find((k) => toNum(firstRow[k]) == null) ?? Object.keys(firstRow)[0] ?? 'x');

  // Coerce every non-x value to a number so string figures still plot.
  const numericKeys = new Set<string>();
  const chartData = isChart ? rawRows.map((r) => {
    const out: any = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === xKey) { out[k] = String(v); continue; }
      const n = toNum(v);
      if (n != null) { out[k] = n; numericKeys.add(k); } else out[k] = v;
    }
    return out;
  }) : [];

  let series: Array<{ key: string; label?: string }> = isChart
    ? (Array.isArray(ex.series) && ex.series.length
        ? ex.series.filter((s: any) => s && numericKeys.has(String(s.key)))
        : [])
    : [];
  if (isChart && !series.length) series = [...numericKeys].map((k) => ({ key: k }));
  const renderChart = isChart && series.length > 0;
  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className={cn('text-on-tertiary-container shrink-0', large ? 'w-4 h-4' : 'w-3.5 h-3.5')} />
        <span className={cn('font-bold text-primary', large ? 'text-sm' : 'text-xs')}>{ex.label || `Exhibit ${ex.id ?? ''}`}</span>
      </div>
      {renderChart ? (
        <>
          <ResponsiveContainer width="100%" height={large ? 300 : 170}>
            {ex.chartType === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 6px 18px rgba(11,31,58,.12)' }} />
                {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label || s.key} fill={EXHIBIT_COLORS[i % EXHIBIT_COLORS.length]} radius={[2, 2, 0, 0]} />)}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 4, right: 6, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 6px 18px rgba(11,31,58,.12)' }} />
                {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key} stroke={EXHIBIT_COLORS[i % EXHIBIT_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            )}
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {series.map((s, i) => (
              <span key={s.key} className="flex items-center gap-1 text-[10px] text-secondary">
                <i className="w-2 h-2 rounded-full" style={{ background: EXHIBIT_COLORS[i % EXHIBIT_COLORS.length] }} />{s.label || s.key}
              </span>
            ))}
          </div>
        </>
      ) : hasTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {ex.columns.map((c: string, i: number) => (
                  <th key={i} className={cn('border-b border-outline-variant/30 px-2 py-1.5 font-bold text-primary', i === 0 ? 'text-left' : 'text-right')}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ex.rows.map((row: string[], ri: number) => (
                <tr key={ri} className="border-b border-outline-variant/10 last:border-0">
                  {(Array.isArray(row) ? row : [row]).map((cell: string, ci: number) => (
                    <td key={ci} className={cn('px-2 py-1.5', ci === 0 ? 'text-left font-medium text-primary' : 'text-right text-on-surface-variant tabular-nums')}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-on-surface-variant whitespace-pre-line font-mono leading-relaxed">{ex.data}</p>
      )}
    </div>
  );
}
