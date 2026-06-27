import { useRef, useState } from 'react';
import { Compass, TrendingUp, Handshake, Settings, DollarSign, ArrowRight, Loader2, FileText, Upload } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/src/lib/api';

const archetypes = [
  { id: 'profitability', title: 'Profitability', desc: 'Declining margins & cost structure.', icon: <DollarSign className="w-5 h-5" /> },
  { id: 'market_entry', title: 'Market Entry', desc: 'Attractiveness & GTM for new markets.', icon: <Compass className="w-5 h-5" /> },
  { id: 'ma', title: 'M&A', desc: 'Synergies & strategic fit.', icon: <Handshake className="w-5 h-5" /> },
  { id: 'growth', title: 'Growth', desc: 'Levers to scale revenue.', icon: <TrendingUp className="w-5 h-5" /> },
  { id: 'pricing', title: 'Pricing', desc: 'Elasticity & tiered pricing.', icon: <DollarSign className="w-5 h-5" /> },
  { id: 'operations', title: 'Operations', desc: 'Supply chain & process efficiency.', icon: <Settings className="w-5 h-5" /> },
];

const industries = ['Tech', 'CPG', 'Pharma', 'Finance', 'Energy', 'Automotive', 'Retail'];
const DIFF_LABELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

const styleMap: Record<string, string> = {
  'Supportive': 'supportive',
  'Neutral': 'neutral',
  'Stress Interview': 'stress',
};

type Module = 'case' | 'product' | 'guesstimate';
const MODULES: { id: Module; label: string; desc: string }[] = [
  { id: 'case', label: 'Consulting Case', desc: 'Profitability, market entry, M&A & more' },
  { id: 'product', label: 'Product Case', desc: 'PM interview: design, strategy, metrics' },
  { id: 'guesstimate', label: 'Guesstimate', desc: 'Market sizing & estimation' },
];
const PRODUCT_FORMATS: { id: string; label: string; desc: string }[] = [
  { id: 'design', label: 'Product Design', desc: 'Design or improve a product for a user segment.' },
  { id: 'strategy', label: 'Product Strategy', desc: 'Should we build/enter X? What’s the roadmap?' },
  { id: 'rootcause', label: 'Root-cause / Metrics', desc: 'A metric moved — diagnose it / define success metrics.' },
  { id: 'prioritization', label: 'Execution / Prioritization', desc: 'Prioritize features under constraints.' },
];

export default function Config() {
  const navigate = useNavigate();
  const location = useLocation();
  const [module, setModule] = useState<Module>(((location.state as { module?: Module } | null)?.module) ?? 'case');
  const [productFormat, setProductFormat] = useState('design');
  const [selectedArchetype, setSelectedArchetype] = useState('market_entry');
  const [selectedIndustry, setSelectedIndustry] = useState('Pharma');
  const [difficulty, setDifficulty] = useState(3);
  const [interviewerStyle, setInterviewerStyle] = useState('Neutral');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsPlan, setNeedsPlan] = useState(false);

  // Custom case import state
  const [importMode, setImportMode] = useState<'ai' | 'custom'>(
    (location.state as { caseId?: string } | null)?.caseId ? 'custom' : 'ai'
  );
  const [customInputType, setCustomInputType] = useState<'text' | 'pdf'>('text');
  const [customTitle, setCustomTitle] = useState('');
  const [customScenario, setCustomScenario] = useState('');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleBeginCase = async () => {
    setLoading(true);
    setError('');
    setNeedsPlan(false);
    try {
      const styleVal = styleMap[interviewerStyle] ?? 'neutral';

      // Product & guesstimate modules: generate + start, then navigate.
      if (module === 'product' || module === 'guesstimate') {
        const body = module === 'product'
          ? { module: 'product', productFormat, difficulty }
          : { module: 'guesstimate', difficulty };
        const { case: c } = await api.post<{ case: { _id: string } }>('/cases/generate', body);
        const caseType = module === 'product' ? `product:${productFormat}` : 'guesstimate';
        const s = await api.post<{ session: { _id: string } }>('/sessions', {
          caseId: c._id,
          config: { difficulty, industry: 'general', caseType, interviewerStyle: styleVal, durationMinutes: 45 },
        });
        navigate(`/session/${s.session._id}`);
        return;
      }

      let caseId: string;

      if (importMode === 'custom') {
        // Validate custom input. Title is optional — we reconstruct the case from
        // the upload and infer a title if you don't give one.
        if (customInputType === 'text' && !customScenario.trim()) throw new Error('Scenario text is required.');
        if (customInputType === 'pdf' && !customFile) throw new Error('Please select a PDF file.');

        let result: { case: { _id: string; type: string; industry: string } };
        if (customInputType === 'pdf' && customFile) {
          const fd = new FormData();
          fd.append('file', customFile);
          if (customTitle.trim()) fd.append('title', customTitle.trim());
          fd.append('type', selectedArchetype);
          fd.append('industry', selectedIndustry.toLowerCase());
          fd.append('difficulty', String(difficulty));
          result = await api.postForm<{ case: { _id: string; type: string; industry: string } }>('/cases/custom', fd);
        } else {
          result = await api.post<{ case: { _id: string; type: string; industry: string } }>('/cases/custom', {
            title: customTitle.trim() || undefined,
            scenario: customScenario.trim(),
            type: selectedArchetype,
            industry: selectedIndustry.toLowerCase(),
            difficulty,
          });
        }
        caseId = result.case._id;
      } else {
        const { case: caseDoc } = await api.post<{ case: { _id: string } }>('/cases/generate', {
          type: selectedArchetype,
          industry: selectedIndustry.toLowerCase(),
          difficulty,
        });
        caseId = caseDoc._id;
      }

      const sessionData = await api.post<{ session: { _id: string } }>('/sessions', {
        caseId,
        config: {
          difficulty,
          industry: selectedIndustry.toLowerCase(),
          caseType: selectedArchetype,
          interviewerStyle: styleMap[interviewerStyle] ?? 'neutral',
          durationMinutes: 45,
        },
      });

      navigate(`/session/${sessionData.session._id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start session. Please try again.';
      // The backend returns a credit/plan message (HTTP 402) when the wallet is empty.
      if (/credit|plan/i.test(message)) setNeedsPlan(true);
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <header>
        <h1 className="font-headline text-2xl font-extrabold text-primary">New case session</h1>
        <p className="text-secondary text-sm mt-1">
          Pick a case type and tune the difficulty — we&apos;ll generate a unique case, or you can import your own.
        </p>
      </header>

      {/* Module selector */}
      <div className="grid grid-cols-3 gap-2.5">
        {MODULES.map((mod) => (
          <button key={mod.id} type="button" onClick={() => setModule(mod.id)}
            className={cn('flex flex-col items-start gap-0.5 p-3.5 rounded-xl border text-left transition-all',
              module === mod.id ? 'border-on-tertiary-container bg-on-tertiary-container/10' : 'border-outline-variant/25 bg-surface-container-lowest hover:border-on-tertiary-container/50')}>
            <span className="font-headline font-bold text-sm text-primary">{mod.label}</span>
            <span className="text-[11px] text-secondary leading-snug">{mod.desc}</span>
          </button>
        ))}
      </div>

      {module === 'case' && (<>
      {/* Case type */}
      <section>
        <label className="label-blueprint mb-3 block">Case type</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {archetypes.map((a) => {
            const on = selectedArchetype === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedArchetype(a.id)}
                className={cn(
                  'flex flex-col items-start gap-1.5 p-3.5 rounded-xl border text-left transition-all',
                  on ? 'border-on-tertiary-container bg-on-tertiary-container/10 shadow-sm'
                     : 'border-outline-variant/25 bg-surface-container-lowest hover:border-on-tertiary-container/50'
                )}
              >
                <span className={cn(on ? 'text-on-tertiary-container' : 'text-primary')}>{a.icon}</span>
                <span className="font-headline font-bold text-sm text-primary">{a.title}</span>
                <span className="text-[11px] text-secondary leading-snug">{a.desc}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Industry */}
      <section>
        <label className="label-blueprint mb-3 block">Industry</label>
        <div className="flex flex-wrap gap-2">
          {industries.map((ind) => (
            <button
              key={ind}
              type="button"
              onClick={() => setSelectedIndustry(ind)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-medium transition-all',
                selectedIndustry === ind
                  ? 'bg-primary text-on-primary'
                  : 'border border-outline-variant/40 text-secondary hover:border-primary'
              )}
            >
              {ind}
            </button>
          ))}
        </div>
      </section>
      </>)}

      {module === 'product' && (
        <section>
          <label className="label-blueprint mb-3 block">Product case format</label>
          <div className="grid grid-cols-2 gap-2.5">
            {PRODUCT_FORMATS.map((f) => (
              <button key={f.id} type="button" onClick={() => setProductFormat(f.id)}
                className={cn('flex flex-col items-start gap-1 p-3.5 rounded-xl border text-left transition-all',
                  productFormat === f.id ? 'border-on-tertiary-container bg-on-tertiary-container/10 shadow-sm' : 'border-outline-variant/25 bg-surface-container-lowest hover:border-on-tertiary-container/50')}>
                <span className="font-headline font-bold text-sm text-primary">{f.label}</span>
                <span className="text-[11px] text-secondary leading-snug">{f.desc}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {module === 'guesstimate' && (
        <section>
          <div className="rounded-lg bg-surface-container-low p-4 border border-outline-variant/15">
            <label className="label-blueprint mb-1.5 block">Guesstimate</label>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              We&apos;ll generate a fresh market-sizing question at your chosen difficulty. Lay out a structure,
              state your own assumptions, do the math out loud, and sanity-check the result — the interviewer
              won&apos;t hand you the numbers.
            </p>
          </div>
        </section>
      )}

      {/* Difficulty + Style */}
      <section className="grid sm:grid-cols-2 gap-8">
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <label className="label-blueprint">Difficulty</label>
            <span className="text-xs font-bold text-on-tertiary-container">{DIFF_LABELS[difficulty - 1]}</span>
          </div>
          <input
            className="w-full appearance-none bg-surface-container h-1.5 rounded-full cursor-pointer accent-on-tertiary-container"
            max="4" min="1" step="1" type="range"
            value={difficulty}
            onChange={(e) => setDifficulty(parseInt(e.target.value))}
          />
          <div className="flex justify-between mt-2 text-[10px] text-secondary/70">
            <span>Beginner</span><span>Expert</span>
          </div>
        </div>

        <div>
          <label className="label-blueprint mb-3 block">Interviewer style</label>
          <div className="grid grid-cols-3 gap-2">
            {(['Supportive', 'Neutral', 'Stress Interview'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setInterviewerStyle(style)}
                className={cn(
                  'px-2 py-2 rounded-lg border text-xs font-semibold transition-all',
                  interviewerStyle === style
                    ? 'border-on-tertiary-container bg-on-tertiary-container/10 text-primary'
                    : 'border-outline-variant/30 text-secondary hover:border-on-tertiary-container/50'
                )}
              >
                {style === 'Stress Interview' ? 'Stress' : style}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Case source (consulting only) */}
      {module === 'case' && (
      <section>
        <label className="label-blueprint mb-3 block">Case source</label>
        <div className="grid grid-cols-2 gap-2.5">
          {([['ai', 'AI-generated', 'Unique case from the settings above', Compass],
             ['custom', 'Import your own', 'Paste text or upload a PDF', Upload]] as const).map(([mode, title, sub, Icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setImportMode(mode)}
              className={cn(
                'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all',
                importMode === mode
                  ? 'border-on-tertiary-container bg-on-tertiary-container/10 text-primary'
                  : 'border-outline-variant/25 text-secondary hover:border-on-tertiary-container/50'
              )}
            >
              <Icon className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-primary">{title}</p>
                <p className="text-[11px] text-secondary leading-snug mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </div>

        {importMode === 'custom' && (
          <div className="space-y-4 mt-4">
            <div className="flex gap-2">
              {([['text', 'Paste text', FileText], ['pdf', 'Upload PDF', Upload]] as const).map(([t, label, Icon]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCustomInputType(t)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                    customInputType === t
                      ? 'border-on-tertiary-container bg-on-tertiary-container/10 text-primary'
                      : 'border-outline-variant/30 text-secondary hover:border-on-tertiary-container/50'
                  )}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Case title — e.g. Declining margins at Retailer X"
              className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3.5 py-2.5 text-sm text-primary placeholder:text-secondary/60 focus:outline-none focus:border-on-tertiary-container"
            />

            {customInputType === 'text' ? (
              <textarea
                value={customScenario}
                onChange={(e) => setCustomScenario(e.target.value)}
                rows={5}
                placeholder="Paste the full case scenario, background, and any data provided…"
                className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3.5 py-2.5 text-sm text-primary placeholder:text-secondary/60 focus:outline-none focus:border-on-tertiary-container resize-none"
              />
            ) : (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
                    customFile
                      ? 'border-on-tertiary-container bg-on-tertiary-container/5 text-primary'
                      : 'border-outline-variant/30 text-secondary hover:border-on-tertiary-container/50'
                  )}
                >
                  <Upload className="w-6 h-6 mx-auto mb-1.5 opacity-60" />
                  <p className="text-xs font-medium">{customFile ? customFile.name : 'Click to select a PDF (max 10 MB)'}</p>
                </div>
                <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setCustomFile(e.target.files?.[0] ?? null)} />
              </>
            )}
          </div>
        )}
      </section>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 pt-6 border-t border-outline-variant/20">
        <div className="min-w-0">
          <p className="text-xs text-secondary">~45 min · spoken interview</p>
          {error && <p className="text-sm text-red-500 font-medium mt-1">{error}</p>}
          {needsPlan && (
            <button
              onClick={() => navigate('/billing')}
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-on-tertiary-container hover:underline"
            >
              Choose a plan <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={handleBeginCase}
          disabled={loading}
          className="shrink-0 bg-primary text-on-primary px-7 py-3 rounded-lg font-headline font-bold text-sm hover:scale-[0.98] transition-transform shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {importMode === 'custom' ? 'Starting…' : 'Generating…'}</>
          ) : (
            <>Begin case <ArrowRight className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  );
}
