/**
 * Parse a GEDCOM file (plus its optional `<name>.config.json`) into the data the app shows.
 *
 * Everything specific to one tree (places, branches, history, notes) lives next to the GEDCOM file
 * in <name>.config.json -- see demo/dummy.config.json. This file holds no family data.
 * Called by the Vite plugin (family-data-plugin.ts); no separate parse step or build/data.json.
 *
 * Output: `data`, bundled into the page (so everything in it is public to anyone who can open the page),
 * and `report`, the data problems with full names, for you only (the plugin writes it to build/checks.txt;
 * it reaches the page only with settings.checksOnPage).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChronicleData, DateValue, Settings, SourceInfo, SurnameInfo } from '../src/types';

// ---- config file shape (every key optional) ----
interface Config {
  settings?: Settings & { livingYears?: number; checksOnPage?: boolean };
  places?: Record<string, { label: string; lat: number; lon: number; approx?: boolean }>;
  placeRules?: { contains: string; place: string }[];
  branches?: Record<string, string>;
  noteEvents?: { person: string; year: number; dated?: boolean; place?: string; title: string; text?: string; link?: string; cat?: string }[];
  history?: { cat: string; start: number; end?: number; place?: string; title: string; text?: string; link?: string; people?: string[] }[];
  surnames?: Record<string, Omit<SurnameInfo, 'name' | 'people' | 'spellings'>>;
  placeNotes?: { text: string; rawPlaceContains: string[] }[];
  sources?: Record<string, Omit<SourceInfo, 'host'>>;
}

/** One GEDCOM line with its sub-lines */
interface Node { tag: string; val: string; xref: string; kids: Node[] }

interface Fact { date: DateValue | null; place: string | null; rawPlace: string | null; cause?: string | null }
interface Indi {
  id: string; given: string; surname: string; married: string; sex: string; fams: string[]; famc: string[];
  notes: string[]; birt?: Fact; deat?: Fact; estBirth?: { y: number; why: string };
  living: boolean; dead: boolean; branch: string | null;
}
interface Fam {
  id: string; husb: string | null; wife: string | null; chil: string[]; div: boolean; spouseDeath: boolean;
  marr?: Fact;
}
/** An event as published, plus the place string exactly as typed in the tree (used for the checks, never published) */
type Event = ChronicleData['events'][number] & { raw?: string | null };

export interface ParseResult {
  data: Omit<ChronicleData, 'geo'>;
  /** the config file used, or null when there is none */
  configPath: string | null;
  /** folder holding the newspaper page images (events list the ones they use under `images`) */
  clipDir: string;
  /** data problems with full names: for build/checks.txt, not the page */
  report: string[];
  /** short summary for the console (no names) */
  summary: string[];
}

const readText = (path: string) => readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');

/** Split on any line break (CRLF, LF, CR and the Unicode ones), without an empty line after a final newline */
function splitLines(s: string): string[] {
  const out = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// ---- generic GEDCOM tree ----
export function readTree(text: string): Node[] {
  const recs: Node[] = [];
  let stack: Node[] = [];
  for (const ln of splitLines(text)) {
    const m = /^(\d+)\s+(@[^@]+@\s+)?(\S+)\s?(.*)$/.exec(ln);
    if (!m) {
      // continuation of an HTML note without a level number
      if (stack.length) stack[stack.length - 1].val += '\n' + ln;
      continue;
    }
    const lvl = Number(m[1]);
    const node: Node = { tag: m[3], val: m[4], xref: (m[2] ?? '').trim(), kids: [] };
    if (lvl === 0) {
      recs.push(node);
      stack = [node];
    } else {
      if (!stack.length) throw new Error(`GEDCOM line before the first record: ${ln}`);
      stack = stack.slice(0, lvl);
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    }
  }
  return recs;
}

const kid = (n: Node | undefined, tag: string) => n?.kids.find(k => k.tag === tag);
const kids = (n: Node, tag: string) => n.kids.filter(k => k.tag === tag);
const val = (n: Node | undefined) => n?.val;
function* walk(n: Node): Generator<Node> {
  yield n;
  for (const k of n.kids) yield* walk(k);
}
const ptr = (v: string) => v.replace(/^@+|@+$/g, '');

// ---- HTML notes: drop tags, decode entities ----
// Latin-1 entities (&nbsp; … &yuml;, code points 160-255 in order) plus the common punctuation ones
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring '
  + 'AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times '
  + 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave '
  + 'eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute '
  + 'ucirc uuml yacute thorn yuml').split(' ');
const ENTITIES: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((n, i) => [n, String.fromCodePoint(160 + i)])),
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…', bull: '•', euro: '€', trade: '™', Abreve: 'Ă', abreve: 'ă',
  Scedil: 'Ş', scedil: 'ş', Tcedil: 'Ţ', tcedil: 'ţ',
};
function unescapeHtml(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (all, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? all;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
  });
}
function cleanNote(v: string): string {
  v = unescapeHtml(v.replace(/<[^>]+>/g, ' ')).replace(/\xa0/g, ' ');
  return scrub(v.replace(/\s+/g, ' ').trim());
}

// ---- free text: remove email addresses and long numbers (phone numbers, personal ID numbers such as the CNP) ----
// [\p{L}\p{N}_] and \p{Nd} match letters and digits in any script, like Python's \w and \d
const EMAIL_RE = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)+/gu;
const NUMBER_RE = /(?<![\p{L}\p{N}_])\+?\(?\p{Nd}[\p{Nd}\s().\-/]{7,}\p{Nd}(?![\p{L}\p{N}_])/gu;
function number(m: string): string {
  const groups = m.match(/\p{Nd}+/gu) ?? [];
  if (groups.join('').length < 9) return m; // dates like 12.03.1950 and ranges like 1941-1945
  if (groups.every(g => g.length === 4 && '12'.includes(g[0]))) return m; // a list of years
  return '[number removed]';
}
export const scrub = (v: string) => v.replace(EMAIL_RE, '[email removed]').replace(NUMBER_RE, number);

// ---- dates ----
const MON: Record<string, number> = Object.fromEntries(
  'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').map((m, i) => [m, i + 1]));
function parseDate(s: string | undefined): DateValue | null {
  if (!s) return null;
  const p = s.split(/\s+/).filter(Boolean);
  const int = (x: string) => (/^\d+$/.test(x) ? Number(x) : NaN);
  const d: DateValue | null =
    p.length === 3 ? { y: int(p[2]), m: MON[p[1]], d: int(p[0]), prec: 'day' }
    : p.length === 2 ? { y: int(p[1]), m: MON[p[0]], prec: 'month' }
    : p.length === 1 ? { y: int(p[0]), prec: 'year' } : null;
  if (!d || Number.isNaN(d.y) || (p.length > 1 && !d.m) || Number.isNaN(d.d)) {
    throw new Error(`Unsupported GEDCOM date "${s}". Only plain dates are read so far (12 FEB 1898, FEB 1898, 1898).`);
  }
  return d;
}

// ---- text helpers ----
const FOLD_FROM = 'ăâîșşțţĂÂÎȘŞȚŢ', FOLD_TO = 'aaissttAAISSTT';
function fold(s: string): string {
  let out = s;
  for (let i = 0; i < FOLD_FROM.length; i++) out = out.split(FOLD_FROM[i]).join(FOLD_TO[i]);
  return out;
}
const key = (s: string) => fold(s).toLowerCase().replace(/ş/g, 's').trim();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const counts = <T extends string>(xs: T[]) => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return c;
};
const fmtCounts = (c: Map<string, number>) =>
  [...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ');

/** The config file read for a GEDCOM file: path/to/x.ged -> path/to/x.config.json */
export const configPathFor = (gedPath: string) => gedPath.replace(/\.[^./\\]*$/, '') + '.config.json';

export function parseGedcom(gedPath: string): ParseResult {
  const cfgPath = configPathFor(gedPath);
  const CFG: Config = existsSync(cfgPath) ? JSON.parse(readText(cfgPath)) : {};
  const SETTINGS = { historyLabel: 'History', homeCountry: 'Romania', timelineStart: null as number | null,
    startEvent: null as string | null, livingYears: 100, livingPeople: 'full' as NonNullable<Settings['livingPeople']>,
    causeOfDeath: false, checksOnPage: false, ...CFG.settings };
  if (!['initials', 'hidden', 'full'].includes(SETTINGS.livingPeople)) {
    throw new Error(`settings.livingPeople must be "initials", "hidden" or "full", not ${JSON.stringify(SETTINGS.livingPeople)}`);
  }
  // Living people are protected unless the config asks for "full" (only for a page that is password-protected)
  const PROTECT = SETTINGS.livingPeople !== 'full';

  const recs = readTree(readText(gedPath));
  // ---- header: which program exported the tree, and when (shown under "Sources") ----
  const head = recs.find(r => r.tag === 'HEAD');
  const headSour = head?.kids.find(k => k.tag === 'SOUR');
  const tree = {
    program: headSour?.kids.find(k => k.tag === 'NAME')?.val.trim() || headSour?.val.trim() || undefined,
    exported: head?.kids.find(k => k.tag === 'DATE')?.val.trim() || undefined,
  };

  // ---- places: config "places"/"placeRules", plus coordinates given in the GEDCOM (PLAC > MAP > LATI/LONG) ----
  const PLACES = new Map<string, { label: string; lat: number; lon: number; approx: boolean }>(
    Object.entries(CFG.places ?? {}).map(([k, v]) => [k, { label: v.label, lat: v.lat, lon: v.lon, approx: v.approx ?? false }]));
  const PLACE_RULES = (CFG.placeRules ?? []).map(r => [r.contains, r.place] as const);
  const coord = (v: string) => {
    v = v.trim();
    const num = v.replace(/^[NSEWnsew]+/, '');
    if (!num || Number.isNaN(Number(num))) throw new Error(`Bad GEDCOM coordinate "${v}"`);
    return (/^[SWsw]/.test(v) ? -1 : 1) * Number(num);
  };
  for (const r of recs) {
    for (const n of walk(r)) {
      const mp = n.tag === 'PLAC' ? kid(n, 'MAP') : undefined;
      const lati = kid(mp, 'LATI'), long = kid(mp, 'LONG');
      if (lati && long && !PLACES.has(n.val)) {
        PLACES.set(n.val, { label: n.val, lat: coord(lati.val), lon: coord(long.val), approx: false });
      }
    }
  }
  function normPlace(raw: string | undefined): [string | null, string | null] {
    if (!raw) return [null, null];
    if (PLACES.has(raw)) return [raw, raw];
    const f = fold(raw);
    for (const [k, v] of PLACE_RULES) if (f.includes(fold(k))) return [v, raw];
    for (const k of PLACES.keys()) if (f.includes(fold(k))) return [k, raw];
    return [null, raw];
  }

  // ---- people ----
  const people = new Map<string, Indi>();
  const fams = new Map<string, Fam>();
  for (const r of recs) {
    if (r.tag === 'INDI') {
      const nm = kid(r, 'NAME');
      const p: Indi = {
        id: ptr(r.xref), given: (val(kid(nm, 'GIVN')) ?? '').trim(), surname: (val(kid(nm, 'SURN')) ?? '').trim(),
        married: (val(kid(nm, 'MARN') ?? kid(nm, '_MARNM')) ?? '').trim(), sex: val(kid(r, 'SEX')) ?? '',
        fams: kids(r, 'FAMS').map(k => ptr(k.val)), famc: kids(r, 'FAMC').map(k => ptr(k.val)), notes: [],
        living: false, dead: false, branch: null,
      };
      for (const tag of ['BIRT', 'DEAT'] as const) {
        const e = kid(r, tag);
        if (!e) continue;
        const [place, rawPlace] = normPlace(val(kid(e, 'PLAC')));
        p[tag === 'BIRT' ? 'birt' : 'deat'] = { date: parseDate(val(kid(e, 'DATE'))), place, rawPlace, cause: val(kid(e, 'CAUS')) ?? null };
      }
      for (const [tag, lab] of [['OCCU', 'Occupation'], ['EDUC', 'Education / work']]) {
        const e = kid(r, tag);
        if (e) p.notes.push(`${lab}: ${scrub(e.val)}`);
      }
      for (const n of kids(r, 'NOTE')) p.notes.push(cleanNote(n.val));
      people.set(p.id, p);
    } else if (r.tag === 'FAM') {
      const f: Fam = {
        id: ptr(r.xref), husb: ptr(val(kid(r, 'HUSB')) ?? '') || null, wife: ptr(val(kid(r, 'WIFE')) ?? '') || null,
        chil: kids(r, 'CHIL').map(k => ptr(k.val)), div: !!kid(r, 'DIV'),
        spouseDeath: kids(r, 'EVEN').some(k => val(kid(k, 'TYPE')) === 'Death of Spouse'),
      };
      const m = kid(r, 'MARR');
      if (m) {
        const [place, rawPlace] = normPlace(val(kid(m, 'PLAC')));
        f.marr = { date: parseDate(val(kid(m, 'DATE'))), place, rawPlace };
      }
      fams.set(f.id, f);
    }
  }

  const by = (pid: string | null | undefined) => (pid ? people.get(pid) : undefined);
  const fam = (fid: string) => fams.get(fid) ?? { id: fid, husb: null, wife: null, chil: [], div: false, spouseDeath: false };
  const year = (p: Indi | undefined, k: 'birt' | 'deat' = 'birt') => p?.[k]?.date?.y || null;
  const birthYear = (p: Indi | undefined) => year(p) || p?.estBirth?.y || null;

  // ---- estimate missing birth years (orange) from relatives ----
  for (let i = 0; i < 6; i++) {
    for (const p of people.values()) {
      if (year(p) || p.estBirth) continue;
      const cands: number[] = [], why: string[] = [];
      for (const fid of p.fams) {
        const f = fam(fid);
        const ys = f.chil.map(c => birthYear(by(c))).filter((y): y is number => !!y);
        if (ys.length) { cands.push(Math.min(...ys) - 27); why.push('about 27 years before the eldest known child'); }
        const sp = f.husb === p.id ? f.wife : f.husb;
        const spy = year(by(sp));
        if (spy) { cands.push(spy + (p.sex === 'M' ? -2 : 2)); why.push("near the spouse's birth year"); }
      }
      for (const fid of p.famc) {
        const sib = fam(fid).chil.filter(c => c !== p.id).map(c => year(by(c))).filter((y): y is number => !!y);
        if (sib.length) { cands.push(Math.round(sib.reduce((a, b) => a + b, 0) / sib.length)); why.push("near the siblings' birth years"); }
      }
      if (cands.length) p.estBirth = { y: why[0].includes('child') ? Math.min(...cands) : cands[0], why: why[0] };
    }
  }

  // ---- living / privacy: no death record and born within the last `livingYears` years ----
  const LIVING_FROM = new Date().getFullYear() - SETTINGS.livingYears;
  for (const p of people.values()) {
    const y = birthYear(p);
    p.dead = !!p.deat;
    p.living = !p.dead && (y === null || y >= LIVING_FROM);
  }

  // ---- branches ----
  // With config "branches" (surname -> branch): mapped surnames; others join a relative's branch, else 'Other'.
  // Without it: birth surname, and people who married into the tree (married name, no parents in the tree)
  // join their married surname.
  const BR = CFG.branches ?? {};
  const hasBR = Object.keys(BR).length > 0;
  const BRK = new Map(Object.entries(BR).map(([k, v]) => [key(k), v]));
  for (const p of people.values()) {
    p.branch = hasBR ? (BRK.get(key(p.surname)) || BRK.get(key(p.married)) || null)
      : ((p.married && !p.famc.length ? p.married : p.surname) || null);
  }
  for (let i = 0; i < 4; i++) {
    for (const p of people.values()) {
      if (p.branch) continue;
      for (const fid of [...p.fams, ...p.famc]) {
        const f = fam(fid);
        const o = [f.husb, f.wife, ...f.chil].find(o => o && o !== p.id && by(o)?.branch);
        if (o) { p.branch = by(o)!.branch; break; }
      }
    }
  }
  for (const p of people.values()) p.branch ||= 'Other';
  if (PROTECT) { // a branch made only of living people would publish their surname as its name
    const deadBranches = new Set([...people.values()].filter(p => !p.living).map(p => p.branch));
    for (const p of people.values()) if (!deadBranches.has(p.branch)) p.branch = 'Other';
  }
  // Branch list for the page: config order (keeps colours stable), only branches that have people, 'Other' always last
  const bcount = counts([...people.values()].map(p => p.branch!));
  const border = [...new Set(Object.values(BR))];
  const BRANCHES = [
    ...border.filter(b => bcount.get(b)),
    ...[...bcount.keys()].filter(b => !border.includes(b) && b !== 'Other').sort(cmp),
    ...(bcount.get('Other') ? ['Other'] : []),
  ];

  type Name = (p: Indi | undefined) => string;
  const realName: Name = p => {
    if (!p) return '(unknown person)';
    const g = p.given || '(name unknown)';
    const s = p.surname && p.surname !== '?' ? p.surname : '';
    return (g + ' ' + s).trim();
  };
  const initials = (s: string) => s.split(/\s+/).filter(w => /^\p{L}/u.test(w)).map(w => [...w][0] + '.').join(' ');
  const hidden = (p: Indi | undefined) => PROTECT && !!p?.living;
  /** Name as published: living people get initials or "Living person" unless settings.livingPeople is "full" */
  const display: Name = p => {
    if (!hidden(p)) return realName(p);
    if (SETTINGS.livingPeople === 'hidden') return 'Living person';
    return initials(realName(p)) || 'Living person';
  };
  const coupleNames = (f: Fam, name: Name = display) => [f.husb, f.wife].filter(Boolean).map(x => name(by(x))).join(' & ');

  // ---- build family events ----
  const events: Event[] = [];
  const add = (e: Record<string, unknown>) => events.push(e as unknown as Event);

  // ---- newspaper clippings: <folder of the GEDCOM>/clippings/<Arcanum doc>_p<page>.jpg, matched to the event's Arcanum links ----
  const clipDir = join(dirname(gedPath), 'clippings');
  const clipFiles = new Set(existsSync(clipDir) ? readdirSync(clipDir) : []);
  const clipsFor = (...texts: (string | undefined)[]) => {
    const out: string[] = [];
    for (const [, doc, pg] of texts.filter(Boolean).join(' ').matchAll(/adt\.arcanum\.com\/\w+\/view\/([^/?\s]+)\/\S*?[?&]pg=(\d+)/g)) {
      const f = `${doc}_p${pg}.jpg`;
      if (clipFiles.has(f) && !out.includes(f)) out.push(f);
    }
    return out;
  };
  for (const p of people.values()) {
    const nm = display(p);
    for (const [k, label] of [['birt', 'Born'], ['deat', 'Died']] as const) {
      const e = p[k];
      if (!e) continue;
      let d = e.date;
      if (d) {
        if (p.living && k === 'birt') d = { y: d.y, prec: 'year' }; // privacy: year only for living people
        const cause = SETTINGS.causeOfDeath ? e.cause : null;
        add({ kind: 'family', cat: 'sure', type: k, person: p.id, date: d, place: hidden(p) ? null : e.place,
          title: `${label}: ${nm}`, text: cause ? `Cause: ${scrub(cause)}` : '', raw: e.rawPlace });
      } else if (k === 'birt' && p.estBirth) {
        add({ kind: 'family', cat: 'plausible', type: k, person: p.id, date: { y: p.estBirth.y, prec: 'est' },
          place: hidden(p) ? null : e.place, title: `Born (estimated): ${nm}`, text: `Year estimated ${p.estBirth.why}.`, raw: e.rawPlace });
      }
    }
    if (!p.birt && p.estBirth && !p.living) {
      add({ kind: 'family', cat: 'plausible', type: 'birt', person: p.id, date: { y: p.estBirth.y, prec: 'est' },
        place: null, title: `Born (estimated): ${nm}`, text: `Year estimated ${p.estBirth.why}.`, raw: null });
    }
  }
  for (const f of fams.values()) {
    const m = f.marr;
    if (!m) continue;
    const names = coupleNames(f);
    // a marriage with a living spouse: year only, no place
    const shield = [f.husb, f.wife].some(x => x && hidden(by(x)));
    if (m.date) {
      add({ kind: 'family', cat: 'sure', type: 'marr', person: f.husb || f.wife, partner: f.wife,
        date: shield ? { y: m.date.y, prec: 'year' } : m.date, place: shield ? null : m.place, title: `Married: ${names}`, text: '', raw: m.rawPlace });
    } else {
      const ys = f.chil.map(c => year(by(c))).filter((y): y is number => !!y);
      if (ys.length) {
        add({ kind: 'family', cat: 'plausible', type: 'marr', person: f.husb || f.wife, partner: f.wife,
          date: { y: Math.min(...ys) - 1, prec: 'est' }, place: shield ? null : m.place, title: `Married (estimated): ${names}`,
          text: 'Year estimated as one year before the eldest known child.', raw: m.rawPlace });
      }
    }
  }

  // ---- facts taken from notes (config "noteEvents"; dated by inference -> plausible, or "cat": "fun" for family stories) ----
  // "dated": true when the year comes from a source (a newspaper page), not an estimate
  for (const n of CFG.noteEvents ?? []) {
    if (!people.has(n.person)) continue;
    if (hidden(people.get(n.person))) continue; // config text names the person: not published for living people
    const images = clipsFor(n.link, n.text);
    add({ kind: 'family', cat: n.cat === 'fun' ? 'fun' : 'plausible', type: 'resi', person: n.person,
      date: { y: n.year, prec: n.dated ? 'year' : 'est' }, place: n.place ?? null, title: n.title, text: n.text ?? '',
      ...(n.link ? { link: n.link } : {}), ...(images.length ? { images } : {}), raw: null });
  }

  // ---- historical events (config "history"): plausible links (orange), context (blue), fun (magenta) ----
  for (const h of CFG.history ?? []) {
    const linked = (h.people ?? []).filter(x => people.has(x));
    const cat = h.cat === 'plausible' && !linked.length ? 'context' : h.cat; // no linked relative in this tree
    add({ kind: 'history', cat, type: 'hist', person: null, people: linked, date: { y: h.start, prec: 'year' },
      end: h.end ?? null, place: h.place ?? null, title: h.title, text: h.text ?? '', link: h.link ?? null });
  }

  // ---- data checks: in build/checks.txt with full names; on the page only with settings.checksOnPage ----
  const all = [...people.values()];
  function dataChecks(name: Name): string[] {
    const checks: string[] = [];
    // possible duplicates: same name and married name, birth years unknown or within 15 years
    const groups = new Map<string, { nm: string; mar: string; ys: (number | null)[] }>();
    for (const p of all) {
      if (name !== realName && hidden(p)) continue; // page version: no hidden names, and no false "Living person" matches
      if (!p.given || p.given === '?') continue;
      const k = JSON.stringify([name(p), p.married]);
      if (!groups.has(k)) groups.set(k, { nm: name(p), mar: p.married, ys: [] });
      groups.get(k)!.ys.push(birthYear(p));
    }
    for (const { nm, mar, ys } of groups.values()) {
      const known = ys.filter((y): y is number => !!y);
      if (ys.length > 1 && (known.length < 2 || Math.max(...known) - Math.min(...known) <= 15)) {
        checks.push(`${ys.length} people named ${nm}` + (mar ? ` (married ${mar})` : '')
          + ' with different parents — possibly one person entered more than once.');
      }
    }
    for (const f of fams.values()) {
      if (f.div && f.spouseDeath) checks.push(`${coupleNames(f, name)}: the family has both "Death of Spouse" and "Divorced" — one is probably wrong.`);
    }
    checks.push(`${all.filter(p => !p.given || p.given === '?').length} people have no given name.`);
    checks.push(`${all.filter(p => p.dead && !p.deat?.date).length} deaths have no date.`);
    const raws = events.map(e => e.raw).filter((r): r is string => !!r).map(fold);
    for (const n of CFG.placeNotes ?? []) { // config "placeNotes": shown when a raw place contains all the given strings
      if (raws.some(r => n.rawPlaceContains.every(x => r.includes(fold(x))))) checks.push(n.text);
    }
    // from the records, not the events: a living person's place is left out of the events on purpose
    const facts = [...all.flatMap(p => [p.birt, p.deat]), ...[...fams.values()].map(f => f.marr)];
    const unplaced = [...new Set(facts.filter(r => r?.rawPlace && !r.place).map(r => r!.rawPlace!))].sort(cmp);
    if (unplaced.length) {
      checks.push(`${unplaced.length} place names have no map location: ` + unplaced.slice(0, 10).join('; ') + (unplaced.length > 10 ? '…' : ''));
    }
    return checks;
  }

  // ---- family names (config "surnames"): meaning, origin, variants, changes over time ----
  // One entry per surname in the tree (birth or married). A config entry also claims the tree surnames
  // listed in its "variants". Spellings found in the tree are listed with the earliest birth year seen.
  const SN_CFG = CFG.surnames ?? {};
  const snOf = new Map<string, string>(); // surname key -> entry name
  for (const [name, info] of Object.entries(SN_CFG)) {
    for (const s of [name, ...(info.variants ?? [])]) if (!snOf.has(key(s))) snOf.set(key(s), name);
  }
  const sn = new Map<string, { name: string; people: string[]; spellings: Map<string, number | null> }>();
  // Protected living people come last and only join names already found on others: a name or spelling
  // carried only by living people is not published.
  for (const p of [...all.filter(p => !hidden(p)), ...all.filter(hidden)]) {
    for (const s of new Set([p.surname, p.married])) {
      if (!s || s === '?') continue;
      if (!snOf.has(key(s))) snOf.set(key(s), s);
      const name = snOf.get(key(s))!;
      if (hidden(p)) {
        const e = sn.get(name);
        if (e && !e.people.includes(p.id)) e.people.push(p.id);
        continue;
      }
      if (!sn.has(name)) sn.set(name, { name, people: [], spellings: new Map() });
      const e = sn.get(name)!;
      if (!e.people.includes(p.id)) e.people.push(p.id);
      const y = birthYear(p);
      const sp = e.spellings;
      if (!sp.has(s) || (y && (sp.get(s) === null || y < sp.get(s)!))) sp.set(s, y);
    }
  }
  const surnames: SurnameInfo[] = [...sn.values()].map(e => {
    const info = SN_CFG[e.name] ?? {};
    const extra = Object.fromEntries((['meaning', 'origin', 'variants', 'changes', 'link'] as const)
      .filter(k => k in info).map(k => [k, info[k]]));
    const spellings = [...e.spellings].sort((a, b) => (a[1] || 9999) - (b[1] || 9999) || cmp(a[0], b[0]))
      .map(([spelling, from]) => ({ spelling, from }));
    return { name: e.name, people: e.people, spellings, ...extra };
  }).sort((a, b) => b.people.length - a.people.length || cmp(fold(a.name), fold(b.name)));
  const undescribed = surnames.filter(e => !(e.name in SN_CFG)).map(e => e.name);
  const allChecks = (name: Name) => [...dataChecks(name), ...(undescribed.length
    ? [`${undescribed.length} family names have no "about" text yet (config "surnames"): ` + undescribed.slice(0, 10).join(', ')
      + (undescribed.length > 10 ? '…' : '')]
    : [])];
  const report = allChecks(realName);

  const publicPerson = (p: Indi): ChronicleData['people'][string] => {
    const out = {
      id: p.id, given: p.given, surname: p.surname, married: p.married, sex: p.sex, branch: p.branch!,
      living: p.living, dead: p.dead, famc: p.famc, fams: p.fams,
      name: display(p), notes: p.notes, by: birthYear(p), byEst: !year(p),
      dy: year(p, 'deat'), bp: p.birt?.place ?? null, dp: p.deat?.place ?? null,
    };
    if (!hidden(p)) return out;
    // living: no notes, no places, names reduced to initials (or nothing)
    const short = SETTINGS.livingPeople === 'initials' ? initials : () => '';
    return { ...out, given: short(p.given) || (SETTINGS.livingPeople === 'hidden' ? 'Living person' : ''),
      surname: short(p.surname), married: short(p.married), notes: [], bp: null, dp: null };
  };
  // Only places that something on the page points to (the config may list more, e.g. a living person's town)
  const usedPlaces = new Set(events.map(e => e.place).filter(Boolean));

  const data: ParseResult['data'] = {
    people: Object.fromEntries([...people].map(([pid, p]) => [pid, publicPerson(p)])),
    places: Object.fromEntries([...PLACES].filter(([k]) => usedPlaces.has(k))),
    // raw place strings stay out of the page: they can be anything the tree's author typed, even an address
    events: events.map(({ raw: _raw, ...e }) => e),
    checks: SETTINGS.checksOnPage ? allChecks(display) : [], branches: BRANCHES, surnames,
    settings: { historyLabel: SETTINGS.historyLabel, homeCountry: SETTINGS.homeCountry,
      timelineStart: SETTINGS.timelineStart, startEvent: SETTINGS.startEvent,
      livingPeople: SETTINGS.livingPeople, causeOfDeath: SETTINGS.causeOfDeath },
    tree,
    sources: Object.entries(CFG.sources ?? {}).map(([host, v]) => ({ host, ...v })),
  };

  const evCounts = counts(events.map(e => `${e.kind}/${e.cat}`));
  return {
    data,
    configPath: existsSync(cfgPath) ? cfgPath : null,
    clipDir,
    report,
    summary: [
      `${people.size} people; events: ${fmtCounts(evCounts)}`,
      `branches: ${fmtCounts(counts(all.map(p => p.branch!)))}`,
      `privacy: living people ${SETTINGS.livingPeople} (${all.filter(hidden).length} protected), `
        + `cause of death ${SETTINGS.causeOfDeath ? 'shown' : 'hidden'}, `
        + `checks ${SETTINGS.checksOnPage ? 'on the page' : 'in build/checks.txt only'}`,
      `${report.length} things to fix: see build/checks.txt`,
      `clippings: ${new Set(events.flatMap(e => (e as { images?: string[] }).images ?? [])).size} newspaper pages linked`,
    ],
  };
}

/** Internal helpers, exported only for the tests (tests/parse-gedcom.test.ts) */
export const __test = { splitLines, parseDate, unescapeHtml, cleanNote };
