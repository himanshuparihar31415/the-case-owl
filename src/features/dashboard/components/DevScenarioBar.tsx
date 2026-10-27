import { useState } from 'react';
import { MOCK_SCENARIOS, getMockScenario, setMockScenario, type ScenarioKey } from '../mock';
import { cn } from '@/src/lib/utils';

/** Development-only strip for flipping between mock user journeys. Never rendered against the real API. */
export default function DevScenarioBar({ onChange }: { onChange: () => void }) {
  const [active, setActive] = useState<ScenarioKey>(getMockScenario);

  const pick = (key: ScenarioKey) => {
    setMockScenario(key);
    setActive(key);
    // A ?scenario= in the URL would override the click on the next load.
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    onChange();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs" role="group" aria-label="Mock data scenario (development only)">
      <span className="font-bold text-amber-800 tracking-wide">MOCK DATA</span>
      {MOCK_SCENARIOS.map((s) => (
        <button
          key={s.key}
          type="button"
          aria-pressed={active === s.key}
          onClick={() => pick(s.key)}
          className={cn('px-2.5 py-1 rounded-md font-semibold transition', active === s.key ? 'bg-amber-800 text-white' : 'text-amber-900 hover:bg-amber-100')}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
