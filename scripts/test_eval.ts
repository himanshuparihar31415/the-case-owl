import 'dotenv/config';
import { generateEvaluationWithAI } from '../server/ai/client.js';

const sample = `[0:05] INTERVIEWER: Welcome. PharmaCorp is considering acquiring BioGenix. Why might they want to?
[0:22] CANDIDATE: uh basically there can be synergies and PharmaCorp can increase business. it can also reduce costs.
[1:10] INTERVIEWER: How would you structure your analysis?
[1:34] CANDIDATE: I will take everything. like strategic rationale, synergies, valuation, maybe integration risk.
[3:40] INTERVIEWER: Let's talk revenue synergy.
[4:02] CANDIDATE: there is a big market and PharmaCorp have many products so they can sell more.
[8:15] CANDIDATE: um I think the market is growing fast.
[12:30] INTERVIEWER: What's your recommendation?
[12:50] CANDIDATE: I think they should probably do it, there are benefits.`;

const result = await generateEvaluationWithAI({
  timestampedTranscript: sample,
  caseTitle: 'PharmaCorp × BioGenix M&A',
  caseType: 'ma',
  difficultyLabel: 'Intermediate ma case',
  durationLabel: '13m 0s',
  hintsUsed: 2,
  fluencyMetrics: {
    wordsPerMinute: 95, fillerWordTotal: 4,
    fillerWords: [{ word: 'uh', count: 1 }, { word: 'basically', count: 1 }, { word: 'like', count: 1 }, { word: 'um', count: 1 }],
    repeatedPhrases: 1, conciseAnswerRate: 100, longestResponseWords: 14, avgWordsPerResponse: 11, longPauses: 1,
  },
});

console.log('TOP-LEVEL KEYS:', Object.keys(result));
console.log('overall:', JSON.stringify((result as any).overall, null, 2));
console.log('competency count:', ((result as any).competencies ?? []).length);
console.log('first competency:', JSON.stringify((result as any).competencies?.[0], null, 2));
console.log('grammar issues:', ((result as any).communication?.grammar?.issues ?? []).length);
console.log('missedOpportunities:', ((result as any).missedOpportunities ?? []).length);
console.log('transcript turns:', ((result as any).transcript ?? []).length);
console.log('priorityPlan:', ((result as any).priorityPlan ?? []).length);
