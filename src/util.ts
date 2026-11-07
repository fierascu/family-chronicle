import { BRANCHES } from './data';
import type { Category, DateValue, Person } from './types';

export const CAT_LABEL: Record<Category, string> = { sure: 'Sure', plausible: 'Plausible', context: 'Context' };

const PALETTE = 10; // --br0…--br9 in CSS
/** CSS class for a branch colour: 'Other' is grey, branches 0-9 use the palette, 10+ get a generated hue */
export const bcls = (b: string) => {
  if (b === 'Other') return 'bo';
  const i = BRANCHES.indexOf(b);
  return i < 0 ? '' : 'b' + i;
};

/** Adds .bN rules for branches past the palette (golden-angle hue spacing) */
export function injectBranchStyles() {
  const n = BRANCHES.filter(b => b !== 'Other').length;
  if (n <= PALETTE) return;
  let css = '';
  for (let i = PALETTE; i < n; i++) css += `.b${i}{--bc:hsl(${Math.round((i * 137.508 + 20) % 360)} 42% var(--bauto-l))}\n`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.append(st);
}

export const swatch = (b: string) => `<span class="sw ${bcls(b)}" aria-hidden="true"></span>`;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ESC[c]);

export const label = (p: Person) => p.name + (!p.surname && p.married ? ` (${p.married} by marriage)` : '');

export const toDate = (d: DateValue) => new Date(d.y, (d.m || 1) - 1, d.d || 1);

const pad = (n?: number) => String(n).padStart(2, '0');
export const fmt = (d?: DateValue | null) =>
  !d ? '' : d.prec === 'est' ? `c. ${d.y}` : d.prec === 'day' ? `${d.d}.${pad(d.m)}.${d.y}` : d.prec === 'month' ? `${pad(d.m)}.${d.y}` : `${d.y}`;

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
