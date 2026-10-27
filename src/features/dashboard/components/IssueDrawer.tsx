import { Play, X } from 'lucide-react';
import type { RecentInterview } from '../types';
import { fmtDelta, deltaClass, fmtDate, fmtTimestamp } from '../format';
import Overlay from './Overlay';

interface Props {
  interview: RecentInterview;
  typeLabel: string;
  onClose: () => void;
  onTranscript: () => void;
  onRetry: () => void;
}

/** Side panel: what went wrong in one interview, with the quote, the timestamp and the fix. */
export default function IssueDrawer({ interview: r, typeLabel, onClose, onTranscript, onRetry }: Props) {
  return (
    <Overlay variant="drawer" onClose={onClose} labelledBy="issue-title">
      <div className="flex items-start justify-between gap-3">
        <div className="label-blueprint font-bold text-on-tertiary-container">{typeLabel} · {fmtDate(r.date)} · {r.durationMinutes}m</div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-secondary hover:text-primary -mt-1"><X className="w-5 h-5" /></button>
      </div>
      <h2 id="issue-title" className="mt-2 font-headline font-extrabold text-lg text-primary leading-snug">{r.title}</h2>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-headline font-extrabold text-3xl text-primary">{r.score.toFixed(1)}</span>
        <span className="text-secondary">/10</span>
        <span className={`ml-2 text-xs font-semibold ${deltaClass(r.deltaVsPrevious)}`}>
          {r.deltaVsPrevious == null ? 'First of its type' : `${fmtDelta(r.deltaVsPrevious)} vs previous ${typeLabel.toLowerCase()}`}
        </span>
      </div>

      <div className="mt-6 label-blueprint">KEY ISSUES</div>
      {r.issues.length === 0 && <p className="mt-2 text-sm text-secondary">No issues were flagged in this interview.</p>}
      <div className="mt-2 space-y-3">
        {r.issues.map((x) => (
          <div key={x.title} className="rounded-xl border border-outline-variant/30 p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-bold text-primary">{x.title}</span>
              <span className="text-xs font-semibold text-on-tertiary-container inline-flex items-center gap-1 shrink-0"><Play className="w-3 h-3 fill-current" /> {fmtTimestamp(x.timestampSec)}</span>
            </div>
            <p className="text-[13px] text-secondary italic leading-relaxed">{x.quote}</p>
            <p className="text-[13px] text-primary leading-relaxed"><b>Fix:</b> {x.fix}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2.5">
        <button type="button" onClick={onTranscript} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-outline-variant/50 text-primary hover:border-primary/40 transition">Full report</button>
        <button type="button" onClick={onRetry} className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-primary text-on-primary hover:bg-primary-container transition">Retry this {typeLabel.toLowerCase()}</button>
      </div>
    </Overlay>
  );
}
