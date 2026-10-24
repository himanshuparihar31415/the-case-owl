// Private-beta access requests.
//
// BETA_INVITE_ONLY gates public signup: while true, "Sign Up" sends people to
// /request-access instead of creating an account. Approved users get login
// details by email and use the normal Sign In.

export const BETA_INVITE_ONLY = true;

export type BetaRole = 'student' | 'professional' | 'tpo';
export type InterviewInterest = 'case' | 'product' | 'guesstimate';

export interface BetaAccessRequest {
  fullName: string;
  email: string;
  country: string;            // ISO2, e.g. "IN"
  phone: { dialCode: string; number: string }; // dialCode without "+", number digits only
  role: BetaRole;
  student?: { college: string; program: string; graduationYear: string };
  professional?: { organization: string; jobTitle: string; experience: string };
  tpo?: { college: string; designation: string; city: string; state: string; studentCount: string };
  interests: InterviewInterest[];
  source: string;
  sourceOther?: string;
  submittedAt: string;        // ISO timestamp
}

// TODO(beta-backend): replace the simulated body with the real call, e.g.
//   return api.post<{ id: string }>('/beta/requests', payload);
export async function submitBetaRequest(payload: BetaAccessRequest): Promise<{ id: string }> {
  await new Promise((r) => setTimeout(r, 900));
  console.info('[beta] access request (simulated, not sent):', payload);
  return { id: `local-${Date.now()}` };
}
