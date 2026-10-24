import { useMemo, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { GraduationCap, Sparkles, Lock, Link2, Check, Flame, Mic, Star, Search, Pencil } from 'lucide-react';
import { COLLEGES, TOP_MBA_COLLEGES } from '@/src/data/colleges';
import { computeStreaks, countByDay, type HistoryItem } from '@/src/lib/practice';

interface Props {
  user: { name: string; email: string } | null;
  history: HistoryItem[];
}

const UNLOCK_AT = 5; // students from one college before the board goes live

const storageKey = (email?: string) => `college:${email ?? 'anon'}`;
const readCollege = (email?: string) => { try { return localStorage.getItem(storageKey(email)) || ''; } catch { return ''; } };
const writeCollege = (email: string | undefined, v: string) => {
  try { v ? localStorage.setItem(storageKey(email), v) : localStorage.removeItem(storageKey(email)); } catch { /* storage unavailable */ }
};

/** Soft, drifting colour fields behind the card. Static when the user prefers reduced motion. */
function Aurora() {
  const reduce = useReducedMotion();
  const blob = (color: string, size: number, pos: CSSProperties, dx: number, dy: number, dur: number) => (
    <motion.div
      aria-hidden
      className="absolute rounded-full pointer-events-none"
      style={{ width: size, height: size, background: `radial-gradient(circle, ${color}, transparent 68%)`, filter: 'blur(8px)', ...pos }}
      animate={reduce ? undefined : { x: [0, dx, 0], y: [0, dy, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
  return (
    <>
      {blob('rgba(8,170,228,.55)', 340, { right: -90, top: -140 }, -40, 30, 9)}
      {blob('rgba(207,124,32,.28)', 260, { left: -80, bottom: -150 }, 40, -20, 11)}
      {blob('rgba(28,154,106,.22)', 220, { right: '35%', bottom: -160 }, -30, -25, 13)}
    </>
  );
}

function CollegePicker({ onPick }: { onPick: (c: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const query = q.trim();
  const matches = useMemo(
    () => (query ? COLLEGES.filter((c) => c.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : TOP_MBA_COLLEGES),
    [query],
  );
  const canUseCustom = query.length >= 3 && !COLLEGES.some((c) => c.toLowerCase() === query.toLowerCase());

  return (
    <div className="relative max-w-md">
      <div className="flex items-center gap-2 bg-white rounded-xl px-3.5 shadow-lg ring-1 ring-white/30 focus-within:ring-2 focus-within:ring-on-tertiary-container transition">
        <Search className="w-4 h-4 text-secondary shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Find your college"
          aria-label="Find your college"
          className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-primary placeholder:text-outline py-3"
        />
      </div>
      {open && (matches.length > 0 || canUseCustom) && (
        <ul className="absolute z-20 mt-1.5 w-full max-h-72 overflow-y-auto scrolling-log bg-white rounded-xl shadow-xl ring-1 ring-outline-variant/20 py-1">
          {!query && <li className="px-3.5 pt-1.5 pb-1 label-blueprint">Top 15 MBA colleges in India</li>}
          {matches.map((c) => (
            <li key={c}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} className="w-full text-left px-3.5 py-2 text-[13px] text-primary hover:bg-surface-container-low transition">
                {c}
              </button>
            </li>
          ))}
          {canUseCustom && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(query)} className="w-full text-left px-3.5 py-2 text-[13px] font-semibold text-on-tertiary-container hover:bg-surface-container-low transition border-t border-outline-variant/10">
                Use &ldquo;{query}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function CollegeArena({ user, history }: Props) {
  const [college, setCollege] = useState(() => readCollege(user?.email));
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    const scored = history.filter((h) => h.score != null);
    const avg = scored.length ? scored.reduce((n, h) => n + (h.score as number), 0) / scored.length / 10 : null;
    return { avg, reps: history.length, streak: computeStreaks(countByDay(history)).current };
  }, [history]);

  const pick = (c: string) => { setCollege(c); writeCollege(user?.email, c); setEditing(false); };

  const invite = async () => {
    const url = `${window.location.origin}/`;
    const text = `I'm practising case interviews on The Case Owl. Put ${college} on the board.`;
    try {
      if (navigator.share) { await navigator.share({ title: 'The Case Owl', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* share dismissed or clipboard blocked */ }
  };

  // Rule-based, built only from the user's own numbers. No model call, no invented peers.
  const take = !stats.reps
    ? `Your first rep sets the first mark on the ${college || 'college'} board. Nobody is ahead of you yet.`
    : `${stats.avg != null ? `Averaging ${stats.avg.toFixed(1)}/10 over ${stats.reps} interview${stats.reps === 1 ? '' : 's'}. ` : `${stats.reps} interview${stats.reps === 1 ? '' : 's'} logged. `}${stats.streak > 0 ? `A ${stats.streak}-day streak already beats everyone who hasn't started.` : 'Rep today and the streak restarts.'}`;

  const showPicker = !college || editing;
  const firstName = user?.name?.split(' ')[0] ?? 'You';

  return (
    <section
      className="relative overflow-hidden rounded-2xl p-5 md:p-6 text-white"
      style={{ background: 'linear-gradient(160deg,#002046,#0A1B33)' }}
      aria-label="Your college"
    >
      <Aurora />
      <div className="relative">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="inline-flex items-center gap-1.5 label-blueprint !text-white/75">
            <GraduationCap className="w-3.5 h-3.5" /> College Arena
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white bg-white/15 backdrop-blur px-2 py-1 rounded-md">
            <Sparkles className="w-3 h-3" /> Owl&apos;s take
          </span>
        </div>

        {showPicker ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-headline font-extrabold text-xl md:text-2xl leading-tight max-w-xl">Every college has one student who&apos;s best at this. Make it yours.</h2>
              <p className="text-white/75 text-[13px] mt-1.5 max-w-xl leading-relaxed">
                Pick your college. Your score, streak and reps go on its board, and you see where you stand the moment classmates join.
              </p>
            </div>
            <CollegePicker onPick={pick} />
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-[12px] font-semibold text-white/70 hover:text-white transition">Cancel</button>
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1.15fr_1fr] gap-5 items-start">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-headline font-extrabold text-xl md:text-2xl leading-tight">{college}</h2>
                <button type="button" onClick={() => setEditing(true)} aria-label="Change college" title="Change college" className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-white/80 text-[13px] mt-1.5 leading-relaxed max-w-md">{take}</p>

              {/* The one real row on the board */}
              <div className="mt-4 rounded-xl bg-white/12 backdrop-blur ring-1 ring-white/25 px-3.5 py-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-on-tertiary-container text-white font-headline font-extrabold flex items-center justify-center shrink-0">
                  {firstName[0]?.toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-headline font-bold text-sm truncate">{user?.name ?? 'You'} <span className="ml-1 text-[10px] font-bold uppercase tracking-wide bg-white/20 px-1.5 py-0.5 rounded">You</span></div>
                  <div className="flex items-center gap-3 text-[11.5px] text-white/75 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" />{stats.avg != null ? stats.avg.toFixed(1) : '—'}</span>
                    <span className="inline-flex items-center gap-1"><Flame className="w-3 h-3 text-[#F0A24A]" />{stats.streak}d</span>
                    <span className="inline-flex items-center gap-1"><Mic className="w-3 h-3" />{stats.reps}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              {/* Empty slots: honest placeholders, no invented classmates */}
              <ul className="space-y-1.5">
                {[2, 3, 4].map((rank) => (
                  <li key={rank} className="flex items-center gap-3 rounded-xl border border-dashed border-white/25 px-3.5 py-2.5">
                    <span className="w-6 text-center font-headline font-bold text-xs text-white/50">#{rank}</span>
                    <span className="flex-1 h-2.5 rounded-full bg-white/10" style={{ maxWidth: `${70 - rank * 8}%` }} />
                    <Lock className="w-3.5 h-3.5 text-white/40 shrink-0" />
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-white/70 mt-3 leading-snug">
                The board goes live when {UNLOCK_AT} students from {college} are on The Case Owl. Bring them.
              </p>
              <button
                type="button"
                onClick={invite}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-primary font-headline font-bold text-[13px] hover:scale-[0.97] transition"
              >
                {copied ? <><Check className="w-4 h-4 text-green-700" /> Copied</> : <><Link2 className="w-4 h-4" /> Invite classmates</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
