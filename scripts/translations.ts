/**
 * Translations of the text written by hand: history events, notes from the tree, config noteEvents, family-name
 * meanings. They live next to the tree as <tree>.i18n.json (gitignored, like the config):
 *
 *   { "ro": { "<text exactly as written>": "<translation>", … }, "en": { … }, "fr": { … }, "pt": { … } }
 *
 * Keyed by the original text, so an entry whose original changes simply stops matching and the page shows the
 * original. Only entries whose original is on the page are published (a note left out for privacy never ships
 * through its translation), and translations are scrubbed of emails and numbers like the originals.
 *
 * Run `node scripts/translations.ts [tree.ged]` to list the texts that still lack a translation;
 * add `--write` to add them to the file with empty values, ready to fill in.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGedcom, scrub } from './parse-gedcom.ts';
import type { ChronicleData } from '../src/types';

export const CONTENT_LANGS = ['en', 'ro', 'fr', 'pt'] as const;
export type Translations = Partial<Record<string, Record<string, string>>>;

export const translationsPathFor = (gedPath: string) => gedPath.replace(/\.[^./\\]*$/, '') + '.i18n.json';

/** titles and texts the parser builds itself; the page translates these from its own dictionary */
const GENERATED = /^(Born \(estimated\)|Born|Died|Married \(estimated\)|Married): |^Year estimated |^Cause: /;

/** every hand-written text on the page, once each, in page order */
export function contentStrings(data: Omit<ChronicleData, 'geo'>): string[] {
  const out = new Set<string>();
  const add = (s?: string | null) => { const t = s?.trim(); if (t && !GENERATED.test(t)) out.add(t); };
  for (const e of data.events) { add(e.title); add(e.text); }
  for (const p of Object.values(data.people)) p.notes.forEach(add);
  for (const s of data.surnames ?? []) { add(s.meaning); add(s.origin); s.changes?.forEach(c => add(c.text)); }
  return [...out];
}

export function readTranslations(path: string): Translations {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

/** only the entries for texts on the page, non-empty, scrubbed */
export function publishedTranslations(all: Translations, strings: string[]): Translations {
  const on = new Set(strings);
  return Object.fromEntries(CONTENT_LANGS.map(l => [l, Object.fromEntries(
    Object.entries(all[l] ?? {}).filter(([k, v]) => on.has(k) && v.trim()).map(([k, v]) => [k, scrub(v)]))]));
}

// ---- command line ----
if (process.argv[1]?.endsWith('translations.ts')) {
  const args = process.argv.slice(2);
  const ged = resolve(args.find(a => !a.startsWith('--')) ?? 'data/tree.ged');
  const path = translationsPathFor(ged);
  const strings = contentStrings(parseGedcom(ged).data);
  const all = readTranslations(path);
  console.log(`${strings.length} texts written by hand in ${ged}`);
  for (const l of CONTENT_LANGS) {
    const missing = strings.filter(s => !all[l]?.[s]?.trim());
    console.log(`${l}: ${strings.length - missing.length} translated, ${missing.length} missing`
      + (l === 'en' ? ' (texts already written in English need no entry)' : ''));
    if (args.includes('--list')) missing.forEach(s => console.log(`  - ${s.length > 100 ? s.slice(0, 100) + '…' : s}`));
    if (args.includes('--write')) for (const s of missing) (all[l] ??= {})[s] = '';
  }
  if (args.includes('--write')) {
    writeFileSync(path, JSON.stringify(all, null, 2) + '\n');
    console.log(`wrote ${path}`);
  }
}
