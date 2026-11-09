/** Matching a typed or linked name to a record. No page imports, so the tests and build scripts can load it directly. */
import type { SurnameInfo } from './types';

/** lower case without accents, for matching: 'Ștefănescu' ~ 'stefanescu' */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** the name a link asks for: ?name=, else ?search=; trimmed, undefined when empty */
export function nameParam(search: string): string | undefined {
  const qs = new URLSearchParams(search);
  return (qs.get('name') ?? qs.get('search'))?.trim() || undefined;
}

/** the family name spelled like the text, or listing it as a variant; accents and case ignored */
export function matchSurname(surnames: SurnameInfo[], text: string): SurnameInfo | undefined {
  const v = fold(text.trim());
  if (!v) return undefined;
  return surnames.find(s => fold(s.name) === v || s.variants?.some(x => fold(x) === v));
}

/** the person whose label is the text, else the first whose label contains it; accents and case ignored */
export function matchPerson<P>(people: P[], label: (p: P) => string, text: string): P | undefined {
  const v = fold(text.trim());
  if (!v) return undefined;
  return people.find(p => fold(label(p)) === v) || people.find(p => fold(label(p)).includes(v));
}

/* ---------- fuzzy matching: spellings that differ a little ----------
 * Everything runs locally, with no library. Two steps:
 *  1. spell(): one spelling for sounds that old registers, other languages and typing write differently
 *     (Câmpeanu / Cîmpeanu, Kostache / Costache, Gheorghe / George, Popescou, double letters).
 *  2. distance(): letters added, missing, changed or swapped (Damerau–Levenshtein), allowed more for longer
 *     words. The first letter must match, which keeps short names apart (Ion / Dan).
 */

/** rules applied in order to a folded word */
const RULES: [RegExp, string][] = [
  [/sch/g, 's'], [/sh/g, 's'], [/[ct]z/g, 't'], [/ts/g, 't'], [/ph/g, 'f'], [/th/g, 't'],
  [/gh/g, 'g'], [/ch/g, 'c'], [/ck/g, 'c'], [/[kq]/g, 'c'], [/x/g, 'cs'], [/w/g, 'v'], [/y/g, 'i'],
  [/ou/g, 'u'], [/(.)\1+/g, '$1'],
];

/** a word as it sounds, roughly: 'Câmpeanu' and 'Cîmpeanu' → 'cimpeanu', 'Kostache' → 'costace' */
export function spell(word: string): string {
  let s = fold(word.replace(/[âÂ]/g, 'î')).replace(/[^a-z]/g, ''); // â and î are the same letter in old spelling
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}

/** letters to add, remove, change or swap to turn a into b */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** how many differences a word of this length may have: 1 up to 4 letters, 2 up to 10, else 3 */
const budget = (n: number) => (n <= 4 ? 1 : n <= 10 ? 2 : 3);

/** how far apart two words are after spell(), or undefined when they are not close; 0 = same spelling */
export function closeness(a: string, b: string): number | undefined {
  const x = spell(a), y = spell(b);
  if (x === y) return x ? 0 : undefined;
  if (Math.min(x.length, y.length) < 3 || x[0] !== y[0]) return undefined;
  const d = distance(x, y);
  return d <= budget(Math.max(x.length, y.length)) ? d : undefined;
}

/** two words are spellings of the same name */
export const close = (a: string, b: string) => closeness(a, b) !== undefined;

const nameWords = (s: string) => fold(s).split(/[^\p{L}]+/u).filter(Boolean);

/** total distance when every word of the text is close to a different word of the name, else undefined */
export function nameDistance(text: string, name: string): number | undefined {
  const want = nameWords(text), have = nameWords(name);
  if (!want.length || want.length > have.length) return undefined;
  let total = 0;
  const used = new Set<number>();
  for (const w of want) {
    let best: [number, number] | undefined;
    have.forEach((h, i) => {
      if (used.has(i)) return;
      const d = closeness(w, h);
      if (d !== undefined && (!best || d < best[0])) best = [d, i];
    });
    if (!best) return undefined;
    used.add(best[1]);
    total += best[0];
  }
  return total;
}

/** the person whose name is spelled most like the text (each typed word close to a word of the name); for when matchPerson finds none */
export function closestPerson<P>(people: P[], label: (p: P) => string, text: string): P | undefined {
  let best: [number, P] | undefined;
  for (const p of people) {
    const d = nameDistance(text, label(p));
    if (d !== undefined && (!best || d < best[0])) best = [d, p];
  }
  return best?.[1];
}

/** the family name, or one of its variants, spelled most like the text; for when matchSurname finds none */
export function closestSurname(surnames: SurnameInfo[], text: string): SurnameInfo | undefined {
  const v = text.trim();
  if (!v || /\s/.test(v)) return undefined; // one word only, so "Ion Popescu" still goes to the person
  let best: [number, SurnameInfo] | undefined;
  for (const s of surnames) for (const n of [s.name, ...(s.variants ?? [])]) {
    const d = closeness(v, n);
    if (d !== undefined && (!best || d < best[0])) best = [d, s];
  }
  return best?.[1];
}

/** every typed word (3 letters or more) is in the text or close to one of its words; for the events filter */
export function fuzzyIncludes(words: string[], text: string): boolean {
  const have = nameWords(text);
  return words.every(w => text.includes(w) || (w.length >= 3 && have.some(h => close(w, h))));
}
