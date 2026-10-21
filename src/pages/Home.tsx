import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { BookOpen, Mic, Building2, ArrowRight, Clock, type LucideIcon } from 'lucide-react';

interface HomeProps {
  user: { name: string; email: string } | null;
}

interface Quick { label: string; to: string; state?: { module: string }; soon?: boolean }

const INTERVIEW_QUICK: Quick[] = [
  { label: 'Case', to: '/config', state: { module: 'case' } },
  { label: 'Guesstimate', to: '/config', state: { module: 'guesstimate' } },
  { label: 'GD', to: '/interview/gd', soon: true },
  { label: 'Resume-based', to: '/interview/resume', soon: true },
  { label: 'General', to: '/interview/general', soon: true },
];

interface ModuleCard {
  title: string;
  Icon: LucideIcon;
  line: string;
  cta: string;
  to: string;
  state?: { module: string };
  quick?: Quick[];
  featured?: boolean;
}

const MODULES: ModuleCard[] = [
  {
    title: 'Preparation',
    Icon: BookOpen,
    line: 'Frameworks, model answers and drills. Two minutes each, aimed at your weak spots.',
    cta: 'Start learning',
    to: '/learn',
  },
  {
    title: 'Interview',
    Icon: Mic,
    line: 'Voice-based mock interviews with instant feedback. Talk, get scored, fix, repeat.',
    cta: 'Start an interview',
    to: '/config',
    state: { module: 'case' },
    quick: INTERVIEW_QUICK,
  },
  {
    title: 'Company-Specific Interview',
    Icon: Building2,
    line: 'Practise for the firm you actually want. Rounds, formats and prep, firm by firm.',
    cta: 'Pick a company',
    to: '/companies',
    featured: true,
  },
];

export default function Home({ user }: HomeProps) {
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6 py-1">
      <header>
        <h1 className="font-headline font-extrabold text-2xl md:text-3xl text-primary leading-tight">
          Welcome back, {firstName}. What are we doing today?
        </h1>
        <p className="text-secondary text-sm mt-1.5">Three ways in. Pick one and get on with it.</p>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        {MODULES.map((m, i) => (
          <motion.div
            key={m.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.06 }}
            className="no-line-card p-5 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-0.5 transition relative overflow-hidden"
            style={m.featured ? { borderColor: 'rgba(8,170,228,0.4)' } : undefined}
          >
            <span
              className="w-12 h-12 rounded-xl flex items-center justify-center text-on-tertiary-container bg-on-tertiary-container/10"
              style={m.featured ? { background: 'linear-gradient(150deg,#08aae4,#002046)', color: '#fff' } : undefined}
            >
              <m.Icon className="w-6 h-6" />
            </span>

            <div className="flex-1">
              <h2 className="font-headline font-extrabold text-lg text-primary leading-tight">{m.title}</h2>
              <p className="text-[13px] text-secondary leading-relaxed mt-1.5">{m.line}</p>

              {m.quick && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {m.quick.map((q) => (
                    <Link
                      key={q.label}
                      to={q.to}
                      state={q.state}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-low text-[12px] font-semibold text-secondary hover:text-primary hover:bg-surface-container transition"
                    >
                      {q.label}
                      {q.soon && <Clock className="w-3 h-3 opacity-60" aria-label="Coming soon" />}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link
              to={m.to}
              state={m.state}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition"
            >
              {m.cta} <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        ))}
      </div>

      <p className="text-[13px] text-secondary">
        Want the numbers on how you&apos;re doing?{' '}
        <Link to="/dashboard" className="font-semibold text-on-tertiary-container hover:underline">Open your dashboard →</Link>
      </p>
    </div>
  );
}
