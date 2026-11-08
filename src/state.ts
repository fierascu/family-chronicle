import { NOW } from './data';
import type { Category } from './types';

export const CATS: Category[] = ['sure', 'plausible', 'context', 'fun'];

export const state = {
  cats: new Set<Category>(CATS),
  branch: '',
  /** selected person id */
  sel: null as string | null,
  /** History row on the timeline: on by default, off on phones where it fills the first screen */
  hist: !window.matchMedia('(max-width: 640px)').matches,
  /** open view in the big panel */
  tab: 'timeline' as 'timeline' | 'events' | 'places',
  /** visible years on the timeline */
  win: [0, NOW] as [number, number],
};

const KEY = 'ftc';
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  // stored as the categories switched off, so categories added later start switched on
  const off: unknown = stored.off ?? (Array.isArray(stored.cats) ? ['sure', 'plausible', 'context'].filter(c => !stored.cats.includes(c)) : []);
  if (Array.isArray(off)) state.cats = new Set(CATS.filter(c => !off.includes(c)));
  if (typeof stored.branch === 'string') state.branch = stored.branch;
  if (['timeline', 'events', 'places'].includes(stored.tab)) state.tab = stored.tab;
} catch { /* storage blocked or corrupt: use defaults */ }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ off: CATS.filter(c => !state.cats.has(c)), branch: state.branch, tab: state.tab })); } catch { /* ignore */ }
}
