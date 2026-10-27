import { Loader2 } from 'lucide-react';
import { isMockDashboard } from '@/src/features/dashboard/api';
import { useDashboard } from '@/src/features/dashboard/useDashboard';
import CoachDashboard from '@/src/features/dashboard/CoachDashboard';
import Onboarding from '@/src/features/dashboard/Onboarding';
import DevScenarioBar from '@/src/features/dashboard/components/DevScenarioBar';

interface AuthUser { name: string; email: string }

/**
 * Two journeys behind one route:
 *   first login (not onboarded) → Onboarding
 *   everyone after              → CoachDashboard
 * All data comes through features/dashboard (mock now, real API later; see its README).
 */
export default function Dashboard({ user }: { user: AuthUser | null }) {
  const { overview, loading, error, reload } = useDashboard();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const showDevBar = isMockDashboard && import.meta.env.DEV;

  let body;
  if (loading && !overview) {
    body = <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" aria-label="Loading your dashboard" /></div>;
  } else if (!overview) {
    body = (
      <div className="py-24 text-center max-w-md mx-auto space-y-4">
        <h1 className="font-headline font-bold text-xl text-primary">We couldn’t load your dashboard.</h1>
        <p className="text-sm text-secondary">{error || 'Something went wrong.'}</p>
        <button type="button" onClick={() => void reload()} className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container transition">Try again</button>
      </div>
    );
  } else if (!overview.profile.onboarded) {
    body = <Onboarding overview={overview} firstName={firstName} reload={reload} />;
  } else {
    body = <CoachDashboard overview={overview} firstName={firstName} reload={reload} />;
  }

  return (
    <div className="space-y-4">
      {showDevBar && <DevScenarioBar onChange={() => void reload()} />}
      {body}
    </div>
  );
}
