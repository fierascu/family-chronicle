/** Matching a typed or linked name to a record. No page imports, so the tests can load it directly. */
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
