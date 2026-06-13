import 'dotenv/config';
import { generateProgressInsight } from '../server/ai/client.js';

const r = await generateProgressInsight({
  sessionCount: 11,
  weeksSpan: 6,
  latestOverall: 5.2,
  delta3: 1.4,
  trajectory: [4.2, 4.0, 2.0, 3.0, 1.2, 3.4, 2.0, 3.4, 3.8, 4.6, 5.2],
  competencyTrends: [
    { skill: 'Structuring', latest: 4.2, trend: 'up' },
    { skill: 'Quantitative', latest: 5.0, trend: 'flat' },
    { skill: 'Business judgment', latest: 5.0, trend: 'up' },
    { skill: 'Communication', latest: 4.0, trend: 'down' },
  ],
  habits: [
    { tag: 'invent_number', label: 'Unvalidated assumptions', count: 9, total: 11 },
    { tag: 'rush_structuring', label: 'Rushed structuring phase', count: 7, total: 11 },
    { tag: 'skip_validation', label: 'Skipped validation', count: 9, total: 11 },
    { tag: 'clarity', label: 'Communication breaks down', count: 6, total: 11 },
  ],
  bestCaseType: 'Profitability',
  untestedCaseTypes: ['M&A'],
});

console.log('KEYS:', Object.keys(r));
console.log('headline:', (r as any).heroHeadline);
console.log('lede:', (r as any).heroLede);
console.log('pills:', (r as any).pills);
console.log('bottleneck.title:', (r as any).bottleneck?.title);
console.log('chain:', JSON.stringify((r as any).bottleneck?.chain));
console.log('pointLossPct:', (r as any).bottleneck?.pointLossPct);
console.log('weeklyPlan:', JSON.stringify((r as any).weeklyPlan, null, 2));
