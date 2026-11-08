/**
 * Builds the demo page and checks that nothing about its living people is in the output.
 *
 * The living people and their details are worked out from demo/dummy.ged and demo/dummy.config.json directly
 * (no death record, born within the last 100 years or with no birth date), not from the parser, so a mistake in
 * the parser's privacy rules shows up here instead of being repeated by the test.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { readTree } from '../scripts/parse-gedcom.ts';
import { tempDir, Y } from './helpers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const demoGed = readFileSync(join(root, 'demo/dummy.ged'), 'utf-8');
const demoCfg = JSON.parse(readFileSync(join(root, 'demo/dummy.config.json'), 'utf-8'));

interface Raw { id: string; given: string; surname: string; living: boolean; texts: string[] }
const people: Raw[] = readTree(demoGed).filter(r => r.tag === 'INDI').map(r => {
  const get = (tag: string) => r.kids.find(k => k.tag === tag);
  const name = get('NAME');
  const sub = (n: typeof name, tag: string) => n?.kids.find(k => k.tag === tag)?.val.trim() ?? '';
  const born = Number(/\d{4}/.exec(sub(get('BIRT'), 'DATE'))?.[0]) || null;
  return {
    id: r.xref.replace(/@/g, ''), given: sub(name, 'GIVN'), surname: sub(name, 'SURN'),
    living: !get('DEAT') && (born === null || born >= Y - 100),
    texts: r.kids.filter(k => ['OCCU', 'EDUC', 'NOTE'].includes(k.tag)).map(k => k.val.trim()),
  };
});
const living = people.filter(p => p.living);
const dead = people.filter(p => !p.living);

/** every text file of the built page, joined */
let output = '';

before(async () => {
  const outDir = tempDir();
  await build({ root, mode: 'demo', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const files = readdirSync(outDir, { recursive: true, encoding: 'utf-8' }).filter(f => /\.(html|js|css|json|txt)$/.test(f));
  output = files.map(f => readFileSync(join(outDir, f), 'utf-8')).join('\n');
});

describe('the demo build', () => {
  test('the demo has living people to protect, and uses a protecting mode', () => {
    assert.ok(living.length >= 2, `living: ${living.map(p => p.given).join(', ')}`);
    assert.notEqual(demoCfg.settings?.livingPeople ?? 'full', 'full');
  });

  test('the output holds the tree (the scan reads the right files)', () => {
    for (const p of dead) assert.ok(output.includes(`${p.given} ${p.surname}`), `${p.given} ${p.surname} is missing`);
  });

  for (const p of living) {
    test(`nothing about ${p.id} (living) is in the output`, () => {
      const word = new RegExp(`\\b${p.given}\\b`);
      assert.ok(!word.test(output), `given name ${p.given}`);
      assert.ok(!output.includes(`${p.given} ${p.surname}`), 'full name');
      for (const t of p.texts) assert.ok(!output.includes(t), `"${t}"`);
      for (const n of demoCfg.noteEvents ?? []) {
        if (n.person !== p.id) continue;
        assert.ok(!output.includes(n.title), `noteEvent "${n.title}"`);
        if (n.text) assert.ok(!output.includes(n.text), `noteEvent text "${n.text}"`);
      }
    });
  }
});
