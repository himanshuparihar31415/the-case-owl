// Preparation content for the company hub. Local only, no backend.
//
// Everything here is GENERAL guidance, written per interview format or skill, never per firm.
// Nothing claims to describe how a specific company hires: the UI labels it as general guidance
// until verified company content exists. Company-specific copy is limited to what companies.ts already holds.

import type { Company, InterviewTypeId } from './companies';

/* ───────────── Know: format guides ───────────── */

export interface StageGuide {
  what: string;
  expect: string[];
  skills: string[];
  prepare: string[];
}

export const STAGE_GUIDES: Record<InterviewTypeId, StageGuide> = {
  case: {
    what: 'You work through a business problem live with an interviewer: structure it, ask for data, do the maths and land a recommendation.',
    expect: [
      'A short problem statement, then time to organise your thoughts',
      'Data and answers given in pieces, only when you ask for them',
      'A closing question asking for your recommendation',
    ],
    skills: ['Structuring', 'Quantitative reasoning', 'Synthesis', 'Communication'],
    prepare: [
      'Practise laying out an issue tree out loud in under two minutes',
      'Drill percentages, growth rates and margins until they are automatic',
      'End every practice case with a one-line recommendation and next steps',
    ],
  },
  guesstimate: {
    what: 'You size a number with no data, such as a market or a demand figure, by breaking it into pieces and stating assumptions.',
    expect: [
      'A deliberately open question with no figures supplied',
      'Follow-ups probing your assumptions',
      'A request to sanity-check your final number',
    ],
    skills: ['Assumption-setting', 'Logical breakdown', 'Numeracy', 'Sense-checking'],
    prepare: [
      'Memorise a few anchor figures (population, households, working days)',
      'Say your formula before you calculate anything',
      'Round aggressively and compare the result with something you know',
    ],
  },
  gd: {
    what: 'You discuss a topic with other candidates while assessors watch how you contribute, rather than what you conclude.',
    expect: [
      'A topic and a short time to think',
      'An open discussion with no leader appointed',
      'Assessors scoring contribution and conduct',
    ],
    skills: ['Structuring ideas', 'Listening', 'Influence without dominating', 'Summarising'],
    prepare: [
      'Practise opening with a one-sentence frame for the discussion',
      'Build on a peer’s point by name before adding your own',
      'Rehearse a 20-second summary you can give at any moment',
    ],
  },
  resume: {
    what: 'You walk through your CV and the interviewer digs into any line, testing what you personally did and what changed because of it.',
    expect: [
      'An opening “walk me through your resume”',
      'Deep follow-ups on projects, numbers and your exact role',
      'Questions on why you made the choices you did',
    ],
    skills: ['Ownership', 'Impact and numbers', 'Self-awareness', 'Concise storytelling'],
    prepare: [
      'For each line, write what you did, the result and one number',
      'Prepare an honest answer on what you would do differently',
      'Cut every story to about two minutes',
    ],
  },
  general: {
    what: 'A conversation about you: your motivation, your fit and the standard questions most candidates are asked.',
    expect: [
      'Questions such as “Why us?”, “Why you?” and a time you failed',
      'Probing on the specifics of your answers',
      'Space for your own questions at the end',
    ],
    skills: ['Motivation', 'Communication', 'Reflection', 'Fit'],
    prepare: [
      'Draft your “Why this company?” answer and say it aloud',
      'Prepare three reusable stories covering leadership, failure and teamwork',
      'Write two or three real questions you want answered',
    ],
  },
};

export const CHECKLIST: Array<{ id: string; label: string }> = [
  { id: 'formats', label: 'Read through each interview format below' },
  { id: 'verify', label: 'Check the firm’s own careers page for the current process' },
  { id: 'timeline', label: 'Note your application deadlines and timeline' },
  { id: 'story-bank', label: 'List the experiences you could use as stories' },
  { id: 'schedule', label: 'Block out practice time before your first round' },
];

/* ───────────── Learn: lessons ───────────── */

export type LessonArea = 'company' | 'skills';

export interface Lesson {
  id: string;
  area: LessonArea;
  title: string;
  minutes: number;
  summary: string;
  body: string[];
  example: { title: string; text: string };
  /** A free-text draft box saved on the device, for lessons that end in something you write. */
  draftPrompt?: string;
  check: {
    question: string;
    options: Array<{ text: string; correct?: boolean; feedback: string }>;
  };
  mockType: InterviewTypeId;
}

export function lessonsFor(company: Pick<Company, 'name'>): Lesson[] {
  const n = company.name;
  return [
    {
      id: 'business',
      area: 'company',
      title: `Understand how ${n} works`,
      minutes: 6,
      summary: 'Be able to explain the firm’s business in a few sentences.',
      body: [
        `Start with the basics: who ${n} serves, what it sells or advises on, and how it earns money. Use the firm’s own website, annual or impact reports and recent news, and write what you find in your own words.`,
        'Interviewers do not need a lecture. They want to hear that you have looked, understood and formed a view on what makes the firm distinctive.',
      ],
      example: {
        title: 'A three-line summary',
        text: `“[Firm] helps [who] with [what]. It earns its money through [model]. What stands out to me is [one specific thing you found].” Fill each blank from a source you can name.`,
      },
      check: {
        question: 'Which is the strongest sign you understand a firm’s business?',
        options: [
          { text: 'You can recite its founding year and headcount', feedback: 'Facts like these are easy to look up and say little about understanding. Interviewers look for how the firm makes its money and what sets it apart.' },
          { text: 'You can explain who it serves, how it earns, and one thing that sets it apart', correct: true, feedback: 'Right. It shows you went beyond the surface and formed your own view.' },
          { text: 'You say you admire its reputation', feedback: 'Reputation is a starting point, not evidence. Back it up with something specific you learned.' },
        ],
      },
      mockType: 'general',
    },
    {
      id: 'relevant-work',
      area: 'company',
      title: 'Find relevant work and recent news',
      minutes: 6,
      summary: 'Connect the firm’s recent activity to your own interests.',
      body: [
        'Look for two or three recent pieces of work, publications, launches or announcements, and pick the ones that genuinely interest you. Depth beats breadth.',
        'Note what the work tells you about the problems the firm cares about. That gives you better material for “Why this company?” and for your own questions at the end.',
      ],
      example: {
        title: 'Turning a source into a talking point',
        text: '“I read [specific piece]. The part that stuck with me was [detail], because it connects to [your experience or interest].”',
      },
      check: {
        question: 'You found ten articles about the firm. What should you do?',
        options: [
          { text: 'Mention as many as you can in the interview', feedback: 'A list sounds rehearsed. One well-understood example is more convincing.' },
          { text: 'Choose two or three that interest you and be ready to discuss them', correct: true, feedback: 'Right. Real interest shows in depth, and you can follow up if the interviewer asks.' },
          { text: 'Skip them and rely on general knowledge', feedback: 'Specifics are what separate a researched answer from a generic one.' },
        ],
      },
      mockType: 'general',
    },
    {
      id: 'role',
      area: 'company',
      title: 'Know what the role asks of you',
      minutes: 5,
      summary: 'Translate the job description into what you must prove.',
      body: [
        'Read the job description for the role you are applying to and underline the verbs: analyse, lead, build, present. Each verb is something the interviewers will want evidence for.',
        'For each one, pick an experience where you did exactly that. If you cannot, note the gap so you can prepare an honest answer.',
      ],
      example: {
        title: 'Verbs to evidence',
        text: 'Job description says “leads client workstreams”. Evidence: the time you led a team project, what you decided, and the result.',
      },
      check: {
        question: 'Why map the job description to your own experiences?',
        options: [
          { text: 'It lets you repeat the description back to them', feedback: 'Echoing the text adds nothing. Evidence from your own experience is what gets scored.' },
          { text: 'It shows you where you already have proof and where you need to prepare', correct: true, feedback: 'Right. It also helps you choose which stories to prepare first.' },
          { text: 'It is only useful for the written application', feedback: 'It helps in every round, because each question probes one of these expectations.' },
        ],
      },
      mockType: 'resume',
    },
    {
      id: 'why-company',
      area: 'company',
      title: `Answer “Why ${n}?”`,
      minutes: 8,
      summary: 'Build a specific, honest answer in three parts.',
      body: [
        'A strong answer has three parts: what draws you to the work, the evidence behind that interest, and what you would bring in return.',
        'Avoid claims that would fit any firm. If your answer still works after swapping in a competitor’s name, it is too generic.',
      ],
      example: {
        title: 'Three-part shape',
        text: '“I am drawn to [type of work] because [personal reason]. I saw it first-hand when [experience], and I have been following [specific thing]. In return I would bring [skill] from [context].”',
      },
      draftPrompt: `Draft your answer to “Why ${n}?” here. It is saved on this device only.`,
      check: {
        question: 'Which answer is the most convincing?',
        options: [
          { text: '“It is a top firm with great people.”', feedback: 'This is true of many firms. It does not show why this one.' },
          { text: '“I am drawn to [work], I saw it when [experience], and I would bring [skill].”', correct: true, feedback: 'Right. It is specific, evidence-backed and states what you offer.' },
          { text: '“My friends work here and recommended it.”', feedback: 'A referral can be a good starting point, but the interviewer wants your own reasons.' },
        ],
      },
      mockType: 'general',
    },
    {
      id: 'structuring',
      area: 'skills',
      title: 'Structure a case',
      minutes: 10,
      summary: 'Break a problem into non-overlapping parts, then test a hypothesis.',
      body: [
        'A good structure is MECE: its branches do not overlap and together cover the problem. Build it as a short issue tree, then say which branch you would check first and why.',
        'Lead with a hypothesis you are willing to drop. State it, ask for the data that would confirm or kill it, and move on if it fails.',
      ],
      example: {
        title: 'Profit has fallen (illustrative)',
        text: 'Profit = Revenue − Costs. Revenue splits into volume × price; costs split into fixed and variable. Hypothesis: revenue is flat, so check costs first, starting with the largest variable line.',
      },
      check: {
        question: 'A candidate splits a profit problem into “costs”, “expensive things” and “prices”. What is wrong?',
        options: [
          { text: 'The branches overlap, because expensive things are part of costs', correct: true, feedback: 'Right. A MECE structure needs branches with no overlap, such as revenue vs costs.' },
          { text: 'There are too few branches', feedback: 'The count is not the problem. Overlap is.' },
          { text: 'Nothing, it is a fine structure', feedback: 'Look again at “costs” and “expensive things”. They describe the same thing.' },
        ],
      },
      mockType: 'case',
    },
    {
      id: 'quant',
      area: 'skills',
      title: 'Quantitative reasoning',
      minutes: 10,
      summary: 'Say the formula first, keep numbers simple, sanity-check the answer.',
      body: [
        'State the formula before you calculate. Round to numbers that are easy to work with and say that you are rounding. Finish by asking whether the answer is plausible.',
        'Talk through the arithmetic. The interviewer is scoring your method, and a slip you catch yourself costs less than a silent error.',
      ],
      example: {
        title: 'Margin change (illustrative)',
        text: 'Revenue is flat at 30 and profit falls from 6 to 4.5. Margin goes from 6/30 = 20% to 4.5/30 = 15%, a drop of 5 percentage points.',
      },
      check: {
        question: 'Revenue is flat at 30. Profit falls from 6 to 4.5. How much did costs change?',
        options: [
          { text: 'Fell by 1.5', feedback: 'Profit fell, and revenue did not change, so costs must have moved the other way.' },
          { text: 'Rose by 1.5', correct: true, feedback: 'Right. Costs went from 24 to 25.5, an increase of 1.5.' },
          { text: 'Rose by 4.5', feedback: 'That is the new profit figure. The cost change is the difference in profit: 6 − 4.5 = 1.5.' },
        ],
      },
      mockType: 'case',
    },
    {
      id: 'stories',
      area: 'skills',
      title: 'Personal experience stories',
      minutes: 8,
      summary: 'Tell a two-minute story with a clear action and result.',
      body: [
        'Pick stories where you personally acted. Use Situation, Task, Action, Result. Spend most of your time on the action and be exact about what you did, not what the team did.',
        'End with a result you can measure, and one thing you learned. Three flexible stories can cover most fit questions.',
      ],
      example: {
        title: 'Shape of a story',
        text: 'Situation and task in two sentences. Action in four, naming your decisions. Result with a number. Lesson in one sentence.',
      },
      check: {
        question: 'Which part of a story should get the most time?',
        options: [
          { text: 'The background situation', feedback: 'Keep it brief. The interviewer is mostly assessing what you did.' },
          { text: 'Your own actions and decisions', correct: true, feedback: 'Right. This is the part that shows your ownership and judgement.' },
          { text: 'The team’s overall achievement', feedback: 'Team results matter, but “we” hides your contribution. Be specific about yours.' },
        ],
      },
      mockType: 'resume',
    },
  ];
}

/* ───────────── Mock: setup options ───────────── */

export type MockMode = 'guided' | 'simulation';

export const MOCK_MODES: Record<MockMode, { label: string; blurb: string }> = {
  guided: { label: 'Guided practice', blurb: 'Take your time. Built for learning the format and building confidence.' },
  simulation: { label: 'Interview simulation', blurb: 'Run it like the real thing, under time pressure and without pauses.' },
};

export interface MockOption {
  duration: string;
  format: string;
  /** Route and router state of the existing interview this type starts. Null while it is not built. */
  start: { to: string; state?: Record<string, unknown> } | null;
}

export const MOCK_OPTIONS: Record<InterviewTypeId, MockOption> = {
  case: {
    duration: 'About 45 minutes',
    format: 'Spoken interview with an AI interviewer. You talk through your structure, ask for data and give a recommendation.',
    start: { to: '/config', state: { module: 'case' } },
  },
  guesstimate: {
    duration: 'About 45 minutes',
    format: 'Spoken interview with an AI interviewer. You size a number out loud and defend your assumptions.',
    start: { to: '/config', state: { module: 'guesstimate' } },
  },
  resume: {
    duration: '15, 25 or 40 minutes, your choice',
    format: 'Spoken interview with an AI interviewer who asks about your uploaded or saved resume.',
    start: { to: '/interview/resume' },
  },
  gd: {
    duration: 'Not available yet',
    format: 'Group discussion practice is being built.',
    start: null,
  },
  general: {
    duration: 'Not available yet',
    format: 'General interview practice is being built.',
    start: null,
  },
};
