import { useCallback, useEffect, useState } from 'react';

/* Per-company prep progress, kept in this browser only (no backend). */

const KEY = 'owl.companyPrep.v1';

export interface CompanyProgress {
  checklist: string[];
  lessonsDone: string[];
  lastLesson?: string;
  mockStarted: boolean;
  drafts: Record<string, string>;
}

const EMPTY: CompanyProgress = { checklist: [], lessonsDone: [], mockStarted: false, drafts: {} };

function readAll(): Record<string, CompanyProgress> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, CompanyProgress>) : {};
  } catch {
    return {};
  }
}

function readOne(id: string): CompanyProgress {
  return { ...EMPTY, ...readAll()[id] };
}

export type UpdateProgress = (fn: (p: CompanyProgress) => CompanyProgress) => void;

export function useCompanyProgress(companyId: string): [CompanyProgress, UpdateProgress] {
  const [progress, setProgress] = useState(() => readOne(companyId));

  useEffect(() => setProgress(readOne(companyId)), [companyId]);

  const update = useCallback<UpdateProgress>((fn) => {
    setProgress((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [companyId]: next }));
      } catch { /* storage unavailable: progress lasts for this visit only */ }
      return next;
    });
  }, [companyId]);

  return [progress, update];
}

export const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
