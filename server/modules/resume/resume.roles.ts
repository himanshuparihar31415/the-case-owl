// Mandatory mid-interview role block (RESUME-001): one "why this role" question plus
// 1-2 domain questions mapped to the role the candidate picked on the setup page.
// Keys must match RESUME_ROLES in resume.service.ts exactly.

export interface RoleBlock {
  why: string;
  domain: string[];
}

export const ROLE_BLOCK: Record<string, RoleBlock> = {
  Consulting: {
    why: 'Why consulting, and what draws them to it over other paths?',
    domain: [
      'Give a framework for a profitability or market-entry problem, then walk through it with a worked example.',
      'How would they structure and size a problem they have never seen before? Ask for a concrete example.',
    ],
  },
  'Product Management': {
    why: 'Why product management, and what draws them to it?',
    domain: [
      'How do they develop a user journey? Ask for an example from a product they know.',
      'How would they approach building a product in their own space, from user problem to first release?',
    ],
  },
  'Finance / IB': {
    why: 'Why finance / investment banking, and what draws them to it?',
    domain: [
      'How would they evaluate an investment or a company\'s financial health? Explain with an example.',
      'Explain a valuation or accounting concept they are comfortable with, using an example.',
    ],
  },
  'Sales & Marketing': {
    why: 'Why sales and marketing, and what draws them to it?',
    domain: [
      'How do they qualify a lead and handle a tough objection? Ask for an example.',
      'How would they position and launch a product, walking through segmentation with an example?',
    ],
  },
  Operations: {
    why: 'Why operations, and what draws them to it?',
    domain: [
      'How would they diagnose and fix a process bottleneck? Ask for an example.',
      'How do they decide which operational improvement to do first when several compete?',
    ],
  },
  HR: {
    why: 'Why HR / people work, and what draws them to it?',
    domain: [
      'How would they handle a conflict between two team members? Ask for an example.',
      'How do they approach a hiring or talent decision where the evidence is mixed?',
    ],
  },
};

export const roleBlockFor = (role: string): RoleBlock =>
  ROLE_BLOCK[role] ?? {
    why: `Why this role, and what draws them to it?`,
    domain: ['Ask one practical question a hiring manager for this role would ask, with a concrete example.'],
  };
