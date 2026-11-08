import { SOURCE_INFO, TREE } from './data';
import { L, locale } from './i18n';
import type { ChronicleEvent } from './types';

/** hosts with a built-in name and description (in i18n.ts, per language); config "sources" adds others or overrides these */
const KNOWN = ['adt.arcanum.com', 'descopera.arhivelenationale.ro', 'familysearch.org', 'wikipedia.org'];

const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** a sub-domain matches its parent (en.wikipedia.org → wikipedia.org) */
const matches = (host: string, h: string) => host === h || host.endsWith('.' + h);

/** a site's name and description: the config entry first, then the built-in one, else the host name */
function infoFor(host: string): { name: string; about: string } {
  const cfg = SOURCE_INFO.find(s => matches(host, s.host));
  const k = KNOWN.find(h => matches(host, h));
  const [name, about] = k ? L.src[k] as [string, string] : [host, host];
  return { name: cfg?.name ?? name, about: cfg?.about ?? about };
}

/** GEDCOM "04 NOV 2026" → "4 Nov 2026" (or the current language's form) */
function niceDate(d: string) {
  const t = Date.parse(d);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

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
    return { label: info.name, about: info.about, url };
  }
  if (e.kind === 'family') return { label: L.src.tree, about: treeAbout() };
  return { label: '', about: '' };
}

/** "Family tree file: MyHeritage Family Tree Builder, exported 4 Nov 2026" */
export const treeAbout = () => L.treeAbout(TREE.program ?? 'GEDCOM', TREE.exported ? niceDate(TREE.exported) : undefined);
