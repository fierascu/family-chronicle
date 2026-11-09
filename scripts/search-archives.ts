// Searches the Romanian National Archives portal (descopera.arhivelenationale.ro) for the people in a
// GEDCOM tree and matches what it finds to them:
//  - catalogue entries whose title names someone (school files, petitions, veterans' files, …)
//  - civil-registry index lines ("În fișier atașat"), e.g. "Lina Ion Staicu Fierăscu -Albeni … 1896-11-27 N-1896-56":
//    child, father, grandfather, surname, village, date, N(birth)/C(marriage)/D(death) and act number.
//    The father's name is checked against the tree, which is what makes a match likely rather than a namesake.
//
//   node scripts/search-archives.ts [tree.ged] [--config tree.config.json] [--only Surname,...]
//
// Writes build/archives.md (matches by person, then everything else by surname) and build/archives.json.
// Only names (given + surname, surname + village) are sent to the portal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { close } from '../src/find.ts';

const BASE = 'https://descopera.arhivelenationale.ro';
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const ONLY = opt('--only')?.split(',').map(s => s.trim());
const gedPath = args[0] ?? 'data/tree.ged';
const cfgPath = opt('--config') ?? gedPath.replace(/\.ged$/i, '.config.json');

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z]+/).filter(w => w.length > 1);
const unescape = (s: string) => s.replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = (s: string) => unescape(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- people and parents from the GEDCOM ----
interface Person { id: string; name: string; given: string[]; surnames: string[]; birth?: number; death?: number; marr: number[]; places: string[]; famc?: string; fams: string[] }
const people = new Map<string, Person>();
const fams = new Map<string, { husb?: string; wife?: string; year?: number }>();
{
  let p: Person | null = null, f: { husb?: string; wife?: string; year?: number } | null = null, ev = '';
  for (const raw of readFileSync(gedPath, 'utf-8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^(\d+) (?:@([^@]+)@ )?(\w+) ?(.*)$/);
    if (!m) continue;
    const [, lvl, xref, tag, v] = m;
    if (lvl === '0') {
      p = f = null;
      if (tag === 'INDI') people.set(xref, p = { id: xref, name: '', given: [], surnames: [], marr: [], places: [], fams: [] });
      if (tag === 'FAM') fams.set(xref, f = {});
      continue;
    }
    if (lvl === '1') ev = tag;
    const y = tag === 'DATE' ? +(v.match(/\b(\d{4})\b/)?.[1] ?? 0) || undefined : undefined;
    if (f) {
      if (tag === 'HUSB' || tag === 'WIFE') f[tag === 'HUSB' ? 'husb' : 'wife'] = v.replace(/@/g, '');
      if (y && ev === 'MARR') f.year = y;
      continue;
    }
    if (!p) continue;
    if (tag === 'NAME' && !p.name) { p.name = v.replace(/\//g, '').replace(/\s+/g, ' ').trim(); p.given = words(v.split('/')[0]); }
    if (tag === 'SURN' || tag === '_MARNM') p.surnames.push(...v.split(',').map(s => s.trim()).filter(s => /\p{L}{2}/u.test(s)));
    if (y && ev === 'BIRT') p.birth = y;
    if (y && ev === 'DEAT') p.death = y;
    if ((tag === 'PLAC' || tag === 'CITY') && (ev === 'BIRT' || ev === 'DEAT' || ev === 'RESI')) p.places.push(v.split(',')[0].trim());
    if (tag === 'FAMC' && lvl === '1') p.famc = v.replace(/@/g, '');
    if (tag === 'FAMS') p.fams.push(v.replace(/@/g, ''));
  }
  for (const p of people.values()) for (const id of p.fams) { const y = fams.get(id)?.year; if (y) p.marr.push(y); }
}
// Undated people get a birth range from their relatives: spouse ±12 years, children 16–50 years later, parents 16–50 earlier.
const range = new Map<string, [number, number]>();
function birthRange(p: Person, depth = 0): [number, number] | undefined {
  if (p.birth) return [p.birth, p.birth];
  if (range.has(p.id) || depth > 3) return range.get(p.id);
  const rs: [number, number][] = [];
  const add = (q: Person | undefined, lo: number, hi: number) => { const r = q && birthRange(q, depth + 1); if (r) rs.push([r[0] + lo, r[1] + hi]); };
  for (const f of p.fams.map(id => fams.get(id))) {
    add(people.get((f?.husb === p.id ? f?.wife : f?.husb) ?? ''), -12, 12);
    for (const c of [...people.values()].filter(c => c.famc && p.fams.includes(c.famc))) add(c, -50, -16);
  }
  const pf = p.famc ? fams.get(p.famc) : undefined;
  add(people.get(pf?.husb ?? ''), 16, 50); add(people.get(pf?.wife ?? ''), 16, 50);
  if (!rs.length) return undefined;
  const r: [number, number] = [Math.max(...rs.map(r => r[0])), Math.min(...rs.map(r => r[1]))];
  if (r[0] > r[1]) r.reverse();
  range.set(p.id, r);
  return r;
}
const parentOf = (p: Person, role: 'husb' | 'wife') => { const f = p.famc && fams.get(p.famc); const id = f && f[role]; return id ? people.get(id) : undefined; };
const spouses = (p: Person) => p.fams.map(id => fams.get(id)).flatMap(f => [f?.husb, f?.wife]).filter(id => id && id !== p.id).map(id => people.get(id!)!).filter(Boolean);

const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf-8')) : {};
const variants = (s: string): string[] => [s, ...(cfg.surnames?.[s]?.variants ?? [])];
const surnamesOf = (p: Person) => [...new Set(p.surnames.flatMap(variants).map(fold))];

// ---- portal ----
interface Rec { name: string; place: string; date: string; year: number; kind: 'N' | 'C' | 'D'; act: string }
interface Hit { cid: string; title: string; cota: string; dates: string; recs: Rec[]; archive?: string }
const hits = new Map<string, Hit>();

async function get(url: string): Promise<string> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'family-chronicle archive search' } });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await sleep(2000 * (i + 1));
  }
  throw new Error('failed: ' + url);
}
const KIND: Record<string, 'N' | 'C' | 'D'> = { nastere: 'N', casatorie: 'C', deces: 'D' };
// Index lines come in two layouts, both cut off at the edges of the snippet:
//   "Lina Ion Staicu Fierăscu -Albeni (Comuna Albeni) 1896-11-27 N-1896-56 GJ-FD-…_0058.TIFF"
//   "Fierascu Ilie George Albeni naștere 1880 2r GJ-F-00001-2-148_0031880-01-11 1N"
function parseRecs(text: string): Rec[] {
  const out: Rec[] = [];
  for (const m of text.matchAll(/(?:^|\.TIFF|\.PDF|\|\|)\s*([^|]*?)\s+(?:\d+|-)?\s*([A-ZĂÂÎȘȚŞŢ][^\d|]*?)\s+(\d{4}-\d\d-\d\d) ([NCD])-(\d{4})-(\d+)/gi))
    out.push({ name: m[1].trim(), place: m[2].replace(/\s+/g, ' ').trim(), date: m[3], year: +m[5], kind: m[4].toUpperCase() as Rec['kind'], act: m[6] });
  for (const m of text.matchAll(/(?:^|\|\||\s\d+[NCD])\s*([^|\d]+?)\s+(\S+)\s+(naștere|nastere|căsătorie|casatorie|deces)\s+(\d{4})\s+\S+\s+\S+?(\d{4}-\d\d-\d\d)\s*(\d+)/gi))
    out.push({ name: m[1].trim(), place: m[2], date: m[5], year: +m[4], kind: KIND[fold(m[3])], act: m[6] });
  return out.filter(r => r.name.split(' ').length >= 2);
}
async function search(q: string, pages = 1) {
  for (let pg = 1; pg <= pages; pg++) {
    const u = `${BASE}/wp-admin/admin-ajax.php?action=get_text_search&searchParams%5Bts%5D=${encodeURIComponent(q)}`
      + `&searchParams%5Bpg%5D=${pg}&searchParams%5Bpgs%5D=100&searchParams%5Bcs%5D=3`;
    const html: string = JSON.parse(await get(u)).data?.htmlResult ?? '';
    const rows = html.split(/<div data-idx='/).slice(1);
    for (const row of rows) {
      const t = row.match(/tblCol_title'>([\s\S]*?)<\/div><div class='tblCol tblCol_nivel/)?.[1] ?? '';
      const cid = row.match(/^(\d+)/)![1];
      const h = hits.get(cid) ?? {
        cid, recs: [],
        title: strip(t.match(/<a [^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''),
        cota: strip(t.match(/Cota UD:<\/b>\s*([^<]+)/)?.[1] ?? ''),
        dates: strip(row.match(/tblCol_date_extreme'>([\s\S]*?)<\/div>/)?.[1] ?? ''),
      };
      const idx = t.split(/<b>În fișier atașat:<\/b>/)[1];
      if (idx) for (const r of parseRecs(strip(idx.replace(/\n/g, ' || ')).replace(/\(Comuna \|\| /g, '(Comuna ')))
        if (!h.recs.some(x => x.date === r.date && x.act === r.act && x.kind === r.kind)) h.recs.push(r);
      hits.set(cid, h);
    }
    if (rows.length < 100) break;
    await sleep(600);
  }
  await sleep(600);
}
async function archiveOf(h: Hit) {
  const t = strip((await get(`${BASE}/cota/?cid=${h.cid}`)).replace(/<(script|style)[\s\S]*?<\/\1>/g, ''));
  h.archive = t.match(/Context arhivă (.*?) Contextul ierarhic/)?.[1];
  await sleep(400);
}

// ---- queries: every surname (all pages), surname + each village, given name + surname for each person ----
const targets = [...people.values()].filter(p => !ONLY || p.surnames.some(s => ONLY.includes(s)));
const queries = new Map<string, number>();
for (const p of targets) for (const s of p.surnames.flatMap(variants)) {
  queries.set(s, 5);
  for (const pl of p.places) queries.set(`${s} ${pl}`, 1);
  if (p.given[0]) queries.set(`${p.name.split(' ')[0]} ${s}`, 1);
}
// Year sweep: "<surname> <year>" brings up the index lines of that year (the portal shows lines for the top rows only).
for (const s of new Set(targets.filter(p => (birthRange(p)?.[0] ?? 9999) <= 1935).flatMap(p => p.surnames.flatMap(variants))))
  for (const v of new Set([s, fold(s)])) for (let y = 1860; y <= 1930; y++) queries.set(`${v} ${y}`, 1);
let n = 0;
for (const [q, pages] of queries) {
  process.stderr.write(`\r${++n}/${queries.size} ${q.padEnd(40)}`);
  try { await search(q, pages); } catch (e) { process.stderr.write(`\n${e}\n`); }
}
process.stderr.write('\n');

// ---- matching ----
interface Match { p: Person; h: Hit; rec?: Rec; score: number; why: string[] }
function matchRec(p: Person, h: Hit, r: Rec): Match | null {
  const w = words(r.name);
  const sn = surnamesOf(p).flatMap(words);
  // spellings in the registers drift (Fierăscu / Fieraşcu / Fierascu, Ioan / Ion), so names match when close
  const isSn = (x: string) => sn.some(s => close(s, x));
  if (!w.some(isSn)) return null;
  const why: string[] = [];
  let score = 0;
  // the person as the subject: first name first, event year fits
  const first = w.find(x => !isSn(x));
  if (first && p.given[0] && close(first, p.given[0])) {
    const y = r.kind === 'N' ? p.birth : r.kind === 'D' ? p.death : undefined;
    const br = birthRange(p);
    if (r.kind === 'N' && !y && br && (r.year < br[0] - 2 || r.year > br[1] + 2)) return null;
    if (r.kind !== 'N' && br && r.year < br[0] + 14) return null;
    if (r.kind === 'C' && p.marr.length && !p.marr.some(m => Math.abs(m - r.year) <= 1)) return null;
    if (y && Math.abs(y - r.year) > 1) return null;
    if (!y && p.birth && (r.year < p.birth - 1 || r.year > (p.death ?? p.birth + 100) + 1)) return null;
    if (r.kind === 'N' && !p.birth && p.death && r.year > p.death) return null;
    score += 2; why.push(y ? `${r.kind === 'N' ? 'birth' : 'death'} year matches` : 'name matches');
    if (y) score += 3;
    const dad = parentOf(p, 'husb');
    const rest = w.filter(x => x !== first && !isSn(x));
    const named = (g?: string) => !!g && rest.some(x => close(x, g));
    if (dad && named(dad.given[0])) { score += 4; why.push(`father ${dad.given[0]} matches`); }
    else if (dad && r.kind !== 'C') { score -= 2; why.push(`father in tree is ${dad.given[0]}`); }
    if (r.kind === 'C' && spouses(p).some(s => named(s.given[0]))) { score += 4; why.push('spouse matches'); }
  }
  if (p.places.some(pl => fold(r.place).includes(fold(pl)))) { score += 1; why.push('place'); }
  return score >= 2 ? { p, h, rec: r, score, why } : null;
}
function matchTitle(p: Person, h: Hit): Match | null {
  const w = words(h.title);
  if (!surnamesOf(p).flatMap(words).some(s => w.some(x => close(s, x))) || !p.given[0] || !w.some(x => close(x, p.given[0]))) return null;
  const ys = [...h.dates.matchAll(/\b(\d{4})\b/g)].map(m => +m[1]);
  if (ys.length && p.birth && Math.max(...ys) < p.birth) return null;
  if (ys.length && p.death && Math.min(...ys) > p.death + 1) return null;
  const why = ['name in title'];
  let score = 2;
  if (ys.length && p.birth) { score += 1; why.push('dates fit lifespan'); }
  if (p.places.some(pl => w.includes(fold(pl)))) { score += 1; why.push('place'); }
  return { p, h, score, why };
}
const matches: Match[] = [];
for (const h of hits.values()) for (const p of targets) {
  for (const r of h.recs) { const m = matchRec(p, h, r); if (m) matches.push(m); }
  const t = matchTitle(p, h); if (t) matches.push(t);
}
matches.sort((a, b) => b.score - a.score);
for (const cid of new Set(matches.map(m => m.h.cid))) await archiveOf(hits.get(cid)!);

// ---- report ----
const link = (h: Hit) => `${BASE}/cota/?cid=${h.cid}`;
const kindName = { N: 'birth', C: 'marriage', D: 'death' };
const recText = (r: Rec) => `${kindName[r.kind]} ${r.date}, act ${r.act}: ${r.name}, ${r.place}`;
const allRecs = [...hits.values()].flatMap(h => h.recs.map(r => ({ h, r })));
const out = [`# Arhivele Naționale: search results`, '',
  `${hits.size} catalogue entries and ${allRecs.length} register index lines; ${new Set(matches.map(m => m.p.id)).size} people in the tree have possible matches.`,
  'Score: 5+ = name, year and father (or spouse) agree; 2–4 = name and year or place only, could be a namesake.', ''];
const byPerson = new Map<string, Match[]>();
for (const m of matches) byPerson.set(m.p.id, [...(byPerson.get(m.p.id) ?? []), m]);
for (const ms of [...byPerson.values()].sort((a, b) => b[0].score - a[0].score)) {
  const p = ms[0].p, dad = parentOf(p, 'husb'), mum = parentOf(p, 'wife');
  const br = birthRange(p);
  out.push(`## ${p.name} (${p.id}; ${p.birth ?? (br ? `born ~${br[0]}–${br[1]}` : '?')}–${p.death ?? ''}${dad || mum ? `; parents ${dad?.name ?? '?'} & ${mum?.name ?? '?'}` : ''})`);
  for (const m of ms) out.push(`- [${m.score}] ${m.rec ? recText(m.rec) : `"${m.h.title}" (${m.h.dates || 'no date'})`} — ${m.why.join(', ')}; ${m.h.archive ?? ''} ${m.h.cota} ${link(m.h)}`);
  out.push('');
}
const used = new Set(matches.map(m => m.h.cid));
out.push('## Register lines not matched (relatives? same village?)', '');
for (const { h, r } of allRecs.sort((a, b) => a.r.date.localeCompare(b.r.date))) out.push(`- ${recText(r)} — ${h.cota} ${link(h)}`);
out.push('', '## Catalogue entries not matched', '');
for (const h of [...hits.values()].filter(h => !used.has(h.cid) && !h.recs.length)) out.push(`- ${h.title} (${h.dates || 'no date'}; ${h.cota}) ${link(h)}`);
mkdirSync('build', { recursive: true });
writeFileSync('build/archives.md', out.join('\n'));
writeFileSync('build/archives.json', JSON.stringify({ hits: [...hits.values()], matches: matches.map(m => ({ person: m.p.id, cid: m.h.cid, rec: m.rec, score: m.score, why: m.why })) }, null, 1));
console.log(`build/archives.md: ${hits.size} entries, ${allRecs.length} index lines, ${matches.length} matches for ${byPerson.size} people`);
