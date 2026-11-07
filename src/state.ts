import { NOW } from './data';
import type { Category } from './types';

export const state = {
  cats: new Set<Category>(['sure', 'plausible', 'context']),
  branch: '',
  /** selected person id */
  sel: null as string | null,
  /** visible years on the timeline */
  win: [0, NOW] as [number, number],
};

const KEY = 'ftc';
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (Array.isArray(stored.cats)) state.cats = new Set(stored.cats);
  if (typeof stored.branch === 'string') state.branch = stored.branch;
} catch { /* storage blocked or corrupt: use defaults */ }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ cats: [...state.cats], branch: state.branch })); } catch { /* ignore */ }
}
