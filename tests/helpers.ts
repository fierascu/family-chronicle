/** Helpers for the tests: a temporary GEDCOM file (plus config) and a few lookups on the parsed data. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { parseGedcom } from '../scripts/parse-gedcom.ts';

/** this year: fixtures put living people's birth years relative to it, so the tests don't age */
export const Y = new Date().getFullYear();

const dirs: string[] = [];
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** a fresh folder, removed when the test file finishes */
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'chronicle-test-'));
  dirs.push(d);
  return d;
}

/** write tree.ged (and tree.config.json when a config is given) to a fresh folder; returns the GEDCOM path */
export function writeTree(ged: string, config?: unknown, extra: Record<string, string> = {}): string {
  const d = tempDir();
  const path = join(d, 'tree.ged');
  writeFileSync(path, ged);
  if (config !== undefined) writeFileSync(join(d, 'tree.config.json'), JSON.stringify(config));
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(d, name), text);
  return path;
}

/** GEDCOM text from indented lines: strips the leading whitespace of each line and adds HEAD/TRLR */
export const ged = (body: string) =>
  ['0 HEAD', '1 SOUR TEST', '2 NAME Test exporter', '1 DATE 4 NOV 2026', '1 CHAR UTF-8',
    ...body.split('\n').map(l => l.trim()).filter(Boolean), '0 TRLR'].join('\n') + '\n';

export const parse = (gedText: string, config?: unknown) => parseGedcom(writeTree(gedText, config));

type Data = ReturnType<typeof parseGedcom>['data'];
export const eventsOf = (d: Data, person: string, type?: string) =>
  d.events.filter(e => e.person === person && (!type || e.type === type));
export const eventTitled = (d: Data, title: string) => d.events.find(e => e.title === title);
