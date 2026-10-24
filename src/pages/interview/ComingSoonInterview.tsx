import { Clock, type LucideIcon } from 'lucide-react';

interface Props {
  Icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  willDo: string[];
}

/** Shared shell for interview types that aren't built yet. No API calls — purely visual. */
export default function ComingSoonInterview({ Icon, title, tagline, description, willDo }: Props) {
  return (
    <div className="max-w-3xl mx-auto space-y-5 py-1">
      <div className="no-line-card p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="w-12 h-12 rounded-xl bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center shrink-0">
            <Icon className="w-6 h-6" />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2.5 py-1 rounded">
            <Clock className="w-3 h-3" /> Coming soon
          </span>
        </div>

        <div className="label-blueprint text-on-tertiary-container mt-5">{tagline}</div>
        <h1 className="font-headline font-extrabold text-2xl text-primary mt-1">{title}</h1>
        <p className="text-secondary text-sm mt-2 leading-relaxed max-w-xl">{description}</p>

        <div className="mt-6">
          <div className="label-blueprint mb-2">What you&apos;ll get</div>
          <ul className="space-y-2">
            {willDo.map((w) => (
              <li key={w} className="flex items-start gap-2.5 text-[13.5px] text-on-surface-variant">
                <span className="w-1.5 h-1.5 rounded-full bg-on-tertiary-container mt-[7px] shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled
            className="px-6 py-3 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm opacity-40 cursor-not-allowed"
          >
            Start Interview
          </button>
          <span className="text-[12px] text-secondary">Not live yet. We&apos;d rather ship it right than ship it Tuesday.</span>
        </div>
      </div>
    </div>
  );
}
