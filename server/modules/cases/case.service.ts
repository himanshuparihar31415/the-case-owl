import { Case, ICase, CaseType, Industry } from '../../models/Case.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generatePharmaProfitabilityCaseWithAI, generateExhibitCaseWithAI, generateProductCaseWithAI, generateGuesstimateWithAI, extractCaseFromTranscript, ExhibitCase, ExtractedCase } from '../../ai/client.js';
import { PharmaTheme, ProductFormat } from '../../ai/prompts.js';

interface CaseFilter {
  type?: CaseType;
  industry?: Industry;
  difficulty?: number;
  tab?: string;
  page?: number;
  limit?: number;
}

export async function listCases(filter: CaseFilter, userId?: string): Promise<{ cases: ICase[]; total: number }> {
  const query: Record<string, unknown> = {};
  if (filter.type) query.type = filter.type;
  if (filter.industry) query.industry = filter.industry;
  if (filter.difficulty) query.difficulty = Number(filter.difficulty);
  if (userId) {
    query.$or = [{ isCustom: false }, { createdBy: userId }];
  }

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 12;
  const skip = (page - 1) * limit;

  const [cases, total] = await Promise.all([
    Case.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Case.countDocuments(query),
  ]);

  return { cases, total };
}

export async function listMyCases(userId: string, limit = 12, page = 1): Promise<{ cases: ICase[]; total: number }> {
  const skip = (page - 1) * limit;
  const filter = { isCustom: true, createdBy: userId };
  const [cases, total] = await Promise.all([
    Case.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Case.countDocuments(filter),
  ]);
  return { cases, total };
}

// Create a custom case from raw uploaded material (pasted text / PDF text / a
// full interview transcript). We RECONSTRUCT it into the same exhibit-rich
// schema generated cases use — neutral candidate-facing prompt, the fact base as
// earned exhibits, a private answer/logic spine — so it presents and interviews
// like a real case instead of dumping raw text into the scenario.
export async function createCustomCase(
  userId: string,
  data: {
    title?: string;
    scenario: string; // raw uploaded material
    description?: string;
    type?: CaseType;
    industry?: Industry;
    difficulty?: number;
  }
): Promise<ICase> {
  let extracted: ExtractedCase | null = null;
  try {
    extracted = await extractCaseFromTranscript(data.scenario);
  } catch (err) {
    console.error('Custom case extraction failed; falling back to raw scenario:', err);
  }

  // If extraction succeeded, store the structured case; otherwise fall back to
  // the old raw-text behavior so an import never hard-fails.
  if (extracted && extracted.situation) {
    const type = (data.type ?? extracted.type ?? 'profitability') as CaseType;
    const industry = (data.industry ?? extracted.industry ?? 'tech') as Industry;
    const difficulty = data.difficulty ?? extracted.difficulty ?? 2;
    return Case.create({
      ...mapExhibitCase(extracted, type, industry, difficulty),
      title: data.title || extracted.title || 'Imported case',
      isCustom: true,
      createdBy: userId,
    });
  }

  return Case.create({
    title: data.title || 'Imported case',
    scenario: data.scenario,
    description: data.description ?? data.scenario.slice(0, 300),
    type: data.type ?? 'operations',
    industry: data.industry ?? 'tech',
    difficulty: data.difficulty ?? 2,
    keyDataPoints: [],
    questions: [],
    isSeeded: false,
    isCustom: true,
    createdBy: userId,
  });
}

export async function getCaseById(id: string): Promise<ICase> {
  const c = await Case.findById(id);
  if (!c) throw new AppError(404, 'Case not found');
  return c;
}

const PHARMA_THEMES: PharmaTheme[] = ['pricing', 'cost', 'competition', 'pipeline'];

// Map the exhibit/quant generator output into a Case doc. keyDataPoints is left
// empty on purpose so the live Case Brief can't spoil the discovery — exhibit
// data is released by the interviewer only when earned. answerKey doubles as the
// report recommendation + the interviewer's private "destination" (plausibleSolution).
function mapExhibitCase(g: ExhibitCase, type: CaseType, industry: Industry, difficulty: number) {
  return {
    title: g.title,
    type, industry, difficulty,
    description: (g.situation ?? '').slice(0, 300),
    scenario: g.situation ?? '',
    keyDataPoints: [],
    questions: [],
    plausibleSolution: g.answerKey,
    answerKey: g.answerKey,
    exhibits: g.exhibits ?? [],
    quant: g.quant,
    privateMechanismNote: g.privateMechanismNote,
    commonWrongTurns: g.commonWrongTurns ?? [],
    forbiddenTerms: g.forbiddenTerms ?? [],
    openingHook: g.openingHook,
    isSeeded: false,
  };
}

export async function generateCase(
  type: CaseType,
  industry: Industry,
  difficulty: number
): Promise<ICase> {
  // Every case uses the rigorous exhibit/quant framework (reconciled numbers, a
  // private crux discovered via earned exhibits). Pharma profitability has a
  // dedicated, tuned generator; all other type/industry combos use the
  // generalized one — both return the same shape.
  const g = (type === 'profitability' && industry === 'pharma')
    ? await generatePharmaProfitabilityCaseWithAI(difficulty, PHARMA_THEMES[Math.floor(Math.random() * PHARMA_THEMES.length)])
    : await generateExhibitCaseWithAI(type, industry, difficulty);

  return Case.create(mapExhibitCase(g, type, industry, difficulty));
}

// Product-management interview case. Stored under module='product'; the live prompt
// (PRODUCT_INTERVIEWER_PROMPT) and tailored scoring are selected by module downstream.
export async function generateProductCase(format: ProductFormat, difficulty: number): Promise<ICase> {
  const g = await generateProductCaseWithAI(format, difficulty);
  return Case.create({
    title: g.title,
    module: 'product',
    subType: format,
    difficulty,
    description: (g.prompt ?? '').slice(0, 300),
    scenario: g.prompt ?? '',
    keyDataPoints: [],
    questions: [],
    plausibleSolution: g.answerKey,
    answerKey: g.answerKey,
    privateMechanismNote: g.privateGuide, // reused as the interviewer's private guide
    commonWrongTurns: g.commonWrongTurns ?? [],
    openingHook: g.openingHook,
    isSeeded: false,
  });
}

// Guesstimate / market-sizing drill. Stored under module='guesstimate'.
export async function generateGuesstimate(difficulty: number): Promise<ICase> {
  const g = await generateGuesstimateWithAI(difficulty);
  return Case.create({
    title: g.title,
    module: 'guesstimate',
    subType: 'guesstimate',
    difficulty,
    description: (g.prompt ?? '').slice(0, 300),
    scenario: g.prompt ?? '',
    keyDataPoints: [],
    questions: [],
    plausibleSolution: g.answerKey,
    answerKey: g.answerKey,
    privateMechanismNote: g.privateGuide,
    commonWrongTurns: g.commonWrongTurns ?? [],
    isSeeded: false,
  });
}

export async function seedCases(): Promise<number> {
  const existing = await Case.countDocuments({ isSeeded: true });
  if (existing > 0) return existing;

  await Case.insertMany(SEEDED_CASES);
  return SEEDED_CASES.length;
}

const SEEDED_CASES = [
  {
    title: 'Declining Profits at Global Coffee Chain',
    type: 'profitability',
    industry: 'retail',
    difficulty: 2,
    description: 'A leading global coffee chain has seen its net profit margin drop from 18% to 11% over two years. The CEO has asked you to diagnose the issue and recommend a path forward.',
    scenario: 'Your client, BrewWorld, operates 8,000 cafes across 45 countries. Revenue has remained flat at $12B, but profitability has eroded significantly. Leadership suspects rising input costs but wants a structured analysis before acting.',
    keyDataPoints: [
      { label: 'Annual Revenue', value: '$12B' },
      { label: 'Net Margin (Now)', value: '11%' },
      { label: 'Net Margin (2 yrs ago)', value: '18%' },
      { label: 'Total Cafes', value: '8,000' },
      { label: 'Avg Ticket Size', value: '$7.20' },
    ],
    questions: [
      'How would you structure your analysis of the profitability decline?',
      'Revenue seems flat — where would you look first, costs or revenue mix?',
      'If COGS rose 3pp but SG&A is down, what does that tell you?',
      'What would you recommend to recover 4pp of margin within 18 months?',
    ],
    isSeeded: true,
  },
  {
    title: 'European Market Entry for US FinTech',
    type: 'market_entry',
    industry: 'finance',
    difficulty: 3,
    description: 'A US-based payments startup with $2B ARR is evaluating entry into Western Europe. Identify the right markets, go-to-market model, and key risks.',
    scenario: 'PaySwift has dominated the US SMB payments market with a SaaS-first model. The board wants to enter Europe within 18 months. You need to advise on country prioritization, partnership vs. organic entry, and regulatory considerations including PSD2.',
    keyDataPoints: [
      { label: 'Current ARR', value: '$2B' },
      { label: 'US Market Share', value: '14%' },
      { label: 'EU Payments TAM', value: '$180B' },
      { label: 'Available Capex', value: '$300M' },
      { label: 'Target Launch', value: '18 months' },
    ],
    questions: [
      'How do you prioritize which European countries to enter first?',
      'What factors make organic entry vs. acquisition more attractive here?',
      'How does PSD2 regulation change your go-to-market strategy?',
      'What are the top 3 risks and how would you mitigate them?',
    ],
    isSeeded: true,
  },
  {
    title: 'Pharma Portfolio M&A Synergies',
    type: 'ma',
    industry: 'pharma',
    difficulty: 4,
    description: 'A top-10 pharma company is acquiring a mid-size oncology biotech. Quantify synergy potential and advise on integration prioritization.',
    scenario: 'MediCorp ($40B market cap) is acquiring OncoGen ($8B deal value, 1.5x revenue multiple). The deal thesis rests on $1.2B in synergies over 5 years. You must validate this number and identify risks to integration.',
    keyDataPoints: [
      { label: 'Deal Value', value: '$8B' },
      { label: 'OncoGen Revenue', value: '$5.2B' },
      { label: 'Target Synergies', value: '$1.2B/yr by Y5' },
      { label: 'R&D Pipeline Overlap', value: '3 assets' },
      { label: 'Combined Sales Force', value: '12,000 reps' },
    ],
    questions: [
      'How would you structure your synergy analysis?',
      'Where do you see the highest-confidence synergies — cost or revenue?',
      'What are the top integration risks you would flag to the CEO?',
      'How would you sequence the integration over the first 100 days?',
    ],
    isSeeded: true,
  },
  {
    title: 'Growth Strategy for EV Charging Network',
    type: 'growth',
    industry: 'energy',
    difficulty: 3,
    description: 'A fast-growing EV charging network wants to 5x its station count in 3 years while maintaining unit economics. Design a growth strategy.',
    scenario: 'ChargeUp operates 2,000 fast-charging stations in the US and is profitable at the unit level. With $500M in fresh funding, the board wants a plan to reach 10,000 stations. You need to recommend where, how, and in what sequence to expand.',
    keyDataPoints: [
      { label: 'Current Stations', value: '2,000' },
      { label: 'Target Stations', value: '10,000 in 3 yrs' },
      { label: 'Funding Available', value: '$500M' },
      { label: 'Avg Station Cost', value: '$120K' },
      { label: 'Avg Utilization', value: '38%' },
    ],
    questions: [
      'What framework would you use to prioritize geographic expansion?',
      'How does the $500M constrain or shape the growth sequencing?',
      'At 38% utilization, do you grow density first or coverage first?',
      'What partnerships would accelerate the network most efficiently?',
    ],
    isSeeded: true,
  },
  {
    title: 'SaaS Pricing Redesign',
    type: 'pricing',
    industry: 'tech',
    difficulty: 2,
    description: 'A B2B SaaS company is moving from per-seat to usage-based pricing. Model the revenue impact and advise on rollout strategy.',
    scenario: 'DataSync ($120M ARR, 800 enterprise customers) currently charges $150/seat/month. Competitors have moved to consumption-based models. Management wants to shift but fears short-term revenue loss. Your job is to advise on pricing architecture and transition plan.',
    keyDataPoints: [
      { label: 'Current ARR', value: '$120M' },
      { label: 'Customers', value: '800 enterprise' },
      { label: 'Avg Seats/Customer', value: '125 seats' },
      { label: 'Current Price', value: '$150/seat/month' },
      { label: 'NRR', value: '108%' },
    ],
    questions: [
      'What are the pros and cons of moving to usage-based pricing?',
      'How would you model the short-term vs. long-term revenue impact?',
      'What customer segments benefit most from the new model?',
      'How would you phase the rollout to minimize churn risk?',
    ],
    isSeeded: true,
  },
  {
    title: 'Supply Chain Bottleneck — Auto OEM',
    type: 'operations',
    industry: 'automotive',
    difficulty: 3,
    description: 'An automotive OEM is losing $2M/day due to a semiconductor shortage creating a production bottleneck. Develop an immediate action plan and long-term resilience strategy.',
    scenario: 'AutoMaker produces 800 vehicles/day but is currently running at 55% capacity due to ECU chip shortages. The shortage is expected to last 9-18 months. Leadership needs both an emergency response and a structural fix.',
    keyDataPoints: [
      { label: 'Normal Output', value: '800 vehicles/day' },
      { label: 'Current Output', value: '440 vehicles/day' },
      { label: 'Revenue Loss/Day', value: '$2M' },
      { label: 'Chip Suppliers', value: '2 primary' },
      { label: 'Shortage Duration', value: '9-18 months' },
    ],
    questions: [
      'What are your immediate actions in the first 30 days?',
      'How do you prioritize which vehicle models to continue producing?',
      'What structural changes prevent this vulnerability long-term?',
      'How would you negotiate differently with semiconductor suppliers?',
    ],
    isSeeded: true,
  },
  {
    title: 'CPG Brand Portfolio Profitability',
    type: 'profitability',
    industry: 'cpg',
    difficulty: 2,
    description: 'A CPG giant is reviewing its 120-brand portfolio after seeing overall margins drop. Advise on portfolio rationalization.',
    scenario: 'ConsumerCo has 120 brands across food, beverage, and personal care. Overall EBIT margin fell from 19% to 15% in 3 years. The CFO suspects the long tail of small brands is dragging performance and wants a data-driven pruning framework.',
    keyDataPoints: [
      { label: 'Total Brands', value: '120' },
      { label: 'Annual Revenue', value: '$35B' },
      { label: 'EBIT Margin (Now)', value: '15%' },
      { label: 'EBIT Margin (3 yrs ago)', value: '19%' },
      { label: 'Top 10 brands revenue share', value: '65%' },
    ],
    questions: [
      'What criteria would you use to evaluate each brand in the portfolio?',
      'How do you handle brands with low profit but high strategic value?',
      'What is the risk of divesting vs. discontinuing a brand?',
      'How would you size the EBIT improvement opportunity?',
    ],
    isSeeded: true,
  },
  {
    title: 'Hospital Network Capacity Optimization',
    type: 'operations',
    industry: 'pharma',
    difficulty: 3,
    description: 'A regional hospital network is struggling with ER overcrowding and surgical suite underutilization — a costly paradox. Diagnose and fix it.',
    scenario: 'HealthFirst operates 12 hospitals and 3 specialty centers. ERs are at 110% capacity causing ambulance diversions, while surgical suites run at 62%. Annual losses attributed to inefficiency total $180M. The CEO wants root causes and a restructuring plan.',
    keyDataPoints: [
      { label: 'Hospitals', value: '12 + 3 specialty' },
      { label: 'ER Utilization', value: '110%' },
      { label: 'Surgical Suite Utilization', value: '62%' },
      { label: 'Efficiency Loss/yr', value: '$180M' },
      { label: 'Annual Patient Volume', value: '2.1M' },
    ],
    questions: [
      'What are the likely root causes of ER overcrowding despite under-used surgical suites?',
      'How would you redesign patient flow across the network?',
      'What quick wins could reduce ER pressure within 90 days?',
      'How do you build a business case for the capital required?',
    ],
    isSeeded: true,
  },
  {
    title: 'Luxury EV Brand Market Entry — Southeast Asia',
    type: 'market_entry',
    industry: 'automotive',
    difficulty: 4,
    description: 'A European luxury EV brand wants to enter Southeast Asia. Prioritize markets, choose go-to-market model, and size the opportunity.',
    scenario: 'LuxVolt (€18B revenue, 4% global EV share) is assessing SEA entry. The region has 680M people, varying infrastructure maturity, and government EV incentives ranging from strong (Thailand) to nascent (Vietnam). You have 12 months to make a recommendation.',
    keyDataPoints: [
      { label: 'Brand Revenue', value: '€18B globally' },
      { label: 'SEA Population', value: '680M' },
      { label: 'SEA EV Market Size', value: '$4.2B by 2027' },
      { label: 'Avg Vehicle Price Target', value: '€65,000' },
      { label: 'Priority Markets', value: '6 identified' },
    ],
    questions: [
      'What framework guides country prioritization in a heterogeneous region?',
      'Should LuxVolt enter via direct distribution, JV, or local partner?',
      'How does charging infrastructure availability affect market sizing?',
      'What is the revenue potential in your recommended lead market?',
    ],
    isSeeded: true,
  },
  {
    title: 'Retail Bank Digital Transformation',
    type: 'growth',
    industry: 'finance',
    difficulty: 3,
    description: 'A traditional retail bank is losing customers to neobanks. Design a digital transformation growth strategy that defends the core and captures new segments.',
    scenario: 'TrustBank ($280B AUM, 4.5M customers) has seen 180K customers leave for digital-only banks in 18 months. Customer acquisition cost is 3x industry average. The CEO wants a 3-year transformation roadmap that leverages the bank\'s branch network as an asset, not a liability.',
    keyDataPoints: [
      { label: 'AUM', value: '$280B' },
      { label: 'Customers', value: '4.5M' },
      { label: 'Customer Attrition', value: '180K in 18mo' },
      { label: 'CAC vs. Neobank', value: '3x higher' },
      { label: 'Branch Network', value: '620 branches' },
    ],
    questions: [
      'What are the root causes of customer attrition to neobanks?',
      'How do you convert 620 branches from cost centers to competitive advantages?',
      'Which customer segments should you prioritize defending vs. acquiring?',
      'How do you sequence tech investment vs. product investment over 3 years?',
    ],
    isSeeded: true,
  },
];
