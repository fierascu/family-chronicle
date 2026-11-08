import { SOURCE_INFO, TREE } from './data';
import type { ChronicleEvent, SourceInfo } from './types';

/** Readable names for sites the tree often links to; config "sources" adds others or overrides these */
const KNOWN: SourceInfo[] = [
  { host: 'adt.arcanum.com', name: 'Arcanum', about: 'Arcanum Digitheca: digitized newspapers' },
  { host: 'descopera.arhivelenationale.ro', name: 'National Archives', about: 'Arhivele Naționale ale României: archive catalogue and civil registers' },
  { host: 'familysearch.org', name: 'FamilySearch', about: 'FamilySearch genealogy records' },
  { host: 'wikipedia.org', name: 'Wikipedia', about: 'Wikipedia: background for history events' },
];

/** label for events that come from the family tree file and link nowhere else */
export const TREE_SOURCE = 'GED file';

const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** the config entry or built-in name for a host; a sub-domain matches its parent (en.wikipedia.org → wikipedia.org) */
const infoFor = (host: string): SourceInfo =>
  [...SOURCE_INFO, ...KNOWN].find(s => host === s.host || host.endsWith('.' + s.host)) ?? { host };

/** GEDCOM "04 NOV 2026" → "4 Nov 2026" */
const niceDate = (d: string) => d.replace(/^0/, '').replace(/\b([A-Z])([A-Z]{2})\b/, (_, a: string, b: string) => a + b.toLowerCase());

export interface EventSource {
  /** short name for the Source column ('' when the event has no source) */
  label: string;
  /** longer description, for the tooltip */
  about: string;
  /** the page the event links to: its "Read more" link, else the first address in its text */
  url?: string;
}

/** where an event comes from: the site it links to, else the family tree file (history notes without a link have none) */
export function sourceOf(e: ChronicleEvent): EventSource {
  const url = e.link || e.text.match(URL_RE)?.[0];
  const host = url ? hostOf(url) : '';
  if (host) {
    const info = infoFor(host);
    return { label: info.name ?? host, about: info.about ?? host, url };
  }
  if (e.kind === 'family') return { label: TREE_SOURCE, about: treeAbout() };
  return { label: '', about: '' };
}

/** "MyHeritage Family Tree Builder, exported 4 Nov 2026" */
export const treeAbout = () =>
  `Family tree file: ${TREE.program ?? 'GEDCOM'}${TREE.exported ? `, exported ${niceDate(TREE.exported)}` : ''}`;
