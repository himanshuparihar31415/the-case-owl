import { useCallback, useEffect, useState } from 'react';
import { dashboardSource } from './api';
import type { DashboardOverview } from './types';

/** Loads the overview and exposes `reload`. Components never call the data source for reads directly. */
export function useDashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError('');
    try {
      setOverview(await dashboardSource.getOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { overview, loading, error, reload: load };
}
