import DATA from 'virtual:family-data';
import { L } from './i18n';
import type { ChronicleEvent, Person } from './types';

export const P = DATA.people;
export const PL = DATA.places;
export const EV: ChronicleEvent[] = DATA.events.map((e, i) => ({ ...e, id: 'e' + i }) as ChronicleEvent);
export const SET = DATA.settings ?? {};
export const CHECKS = DATA.checks;
export const GEO = DATA.geo;
export const SURNAMES = DATA.surnames ?? [];
export const TREE = DATA.tree ?? {};
export const SOURCE_INFO = DATA.sources ?? [];
export const NOW = new Date().getFullYear();
export const people: Person[] = Object.values(P);
export const HOME = SET.homeCountry || 'Romania';
/** the timeline's history row: config historyLabel, else "History" in the current language */
export const historyLabel = () => SET.historyLabel || L.historyRow;

// Branch list comes from the parser ("branches"); fall back to the people's branches for older data files
export const BRANCHES: string[] = DATA.branches ?? (() => {
  const s = [...new Set(people.map(p => p.branch))].filter(b => b !== 'Other').sort();
  return people.some(p => p.branch === 'Other') ? [...s, 'Other'] : s;
})();

/** Families rebuilt from people's famc/fams lists */
interface Family { husb?: string; wife?: string; chil: string[] }
const FAMILIES: Record<string, Family> = {};
for (const p of people) {
  for (const f of p.fams) {
    FAMILIES[f] ??= { chil: [] };
    if (p.sex === 'M') FAMILIES[f].husb = p.id; else FAMILIES[f].wife = p.id;
  }
  for (const f of p.famc) (FAMILIES[f] ??= { chil: [] }).chil.push(p.id);
}

export function relatives(p: Person) {
  const F = FAMILIES;
  return {
    parents: p.famc.flatMap(f => [F[f]?.husb, F[f]?.wife]),
    sibs: p.famc.flatMap(f => F[f]?.chil ?? []).filter(c => c !== p.id),
    spouses: p.fams.map(f => (F[f]?.husb === p.id ? F[f]?.wife : F[f]?.husb)),
    kids: p.fams.flatMap(f => F[f]?.chil ?? []),
  };
}

/** The places a person passed through, in date order, without consecutive repeats */
export function personPath(p: Person): string[] {
  const ev = EV.filter(e => e.kind === 'family' && (e.person === p.id || e.partner === p.id) && e.place)
    .sort((a, b) => a.date.y - b.date.y);
  const seq: string[] = [];
  ev.forEach(e => { if (seq[seq.length - 1] !== e.place) seq.push(e.place!); });
  return seq;
}
