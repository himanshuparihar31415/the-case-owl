// Placeholder company catalogue — local only, no backend. Edit freely.
// Flip `prepAvailable` / extend `availableInterviewTypes` as real content ships.

export type InterviewTypeId = 'case' | 'guesstimate' | 'gd' | 'resume' | 'general';

export const INTERVIEW_TYPES: Record<InterviewTypeId, { label: string; blurb: string }> = {
  case: { label: 'Case Interview', blurb: 'Structure, crunch numbers, land a recommendation.' },
  guesstimate: { label: 'Guesstimate', blurb: 'Size a market out loud, with defensible assumptions.' },
  gd: { label: 'Group Discussion', blurb: 'Hold your ground and add signal in a crowded room.' },
  resume: { label: 'Resume-Based Interview', blurb: 'Defend every line on your CV.' },
  general: { label: 'General Interview', blurb: 'Fit, motivation, and the questions everyone gets.' },
};

export type CompanyCategory = 'Consulting' | 'Big Tech' | 'Product & Startups' | 'Finance';

export const COMPANY_CATEGORIES: CompanyCategory[] = ['Consulting', 'Big Tech', 'Product & Startups', 'Finance'];

export interface Company {
  id: string;
  name: string;
  category: CompanyCategory;
  blurb: string;
  availableInterviewTypes: InterviewTypeId[];
  prepAvailable: boolean;
}

const CORE: InterviewTypeId[] = ['case', 'guesstimate', 'resume', 'general'];
const WITH_GD: InterviewTypeId[] = ['case', 'gd', 'resume', 'general'];

export const companies: Company[] = [
  { id: 'mckinsey', name: 'McKinsey', category: 'Consulting', blurb: 'Interviewer-led cases and a heavy emphasis on structured problem solving.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'bcg', name: 'BCG', category: 'Consulting', blurb: 'Candidate-led cases that reward creativity and sharp business judgement.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'bain', name: 'Bain', category: 'Consulting', blurb: 'Fast-paced cases with a strong results focus and a real fit component.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'kearney', name: 'Kearney', category: 'Consulting', blurb: 'Operations-heavy cases and practical, implementation-minded answers.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'deloitte', name: 'Deloitte', category: 'Consulting', blurb: 'Broad practice mix. Expect case rounds plus group and resume screens.', availableInterviewTypes: WITH_GD, prepAvailable: false },
  { id: 'strategy-and', name: 'Strategy& (PwC)', category: 'Consulting', blurb: 'Strategy-first cases with an emphasis on capability and operating model.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'ey-parthenon', name: 'EY-Parthenon', category: 'Consulting', blurb: 'Transaction and strategy cases, often with a numbers-first approach.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'accenture-strategy', name: 'Accenture Strategy', category: 'Consulting', blurb: 'Technology-led transformation cases and structured group exercises.', availableInterviewTypes: WITH_GD, prepAvailable: false },
  { id: 'oliver-wyman', name: 'Oliver Wyman', category: 'Consulting', blurb: 'Analytical, quant-forward cases, especially in financial services.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'zs-associates', name: 'ZS Associates', category: 'Consulting', blurb: 'Life-sciences and analytics cases with a strong guesstimate component.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'amazon', name: 'Amazon', category: 'Big Tech', blurb: 'Leadership-principle stories plus business and product problem solving.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'google', name: 'Google', category: 'Big Tech', blurb: 'Structured product and estimation questions with a strong thinking-out-loud bar.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'microsoft', name: 'Microsoft', category: 'Big Tech', blurb: 'Product sense, scenario questions and behavioural depth.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'flipkart', name: 'Flipkart', category: 'Product & Startups', blurb: 'Product and business cases grounded in Indian e-commerce.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'swiggy', name: 'Swiggy', category: 'Product & Startups', blurb: 'Marketplace, ops and growth cases for a fast-moving consumer product.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'zomato', name: 'Zomato', category: 'Product & Startups', blurb: 'Product thinking and unit-economics questions in food and quick commerce.', availableInterviewTypes: CORE, prepAvailable: false },
  { id: 'goldman-sachs', name: 'Goldman Sachs', category: 'Finance', blurb: 'Resume deep-dives, market awareness and structured fit interviews.', availableInterviewTypes: ['resume', 'general', 'gd'], prepAvailable: false },
];

export const getCompany = (id: string | undefined) => companies.find((c) => c.id === id);

/** "Strategy& (PwC)" -> "S", "Oliver Wyman" -> "OW", "McKinsey" -> "M" */
export const monogram = (name: string) =>
  name.replace(/\(.*?\)/g, '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
