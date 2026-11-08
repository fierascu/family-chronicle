/** scripts/translations.ts: which hand-written texts are translated, and which translations reach the page. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { contentStrings, publishedTranslations, readTranslations, translationsPathFor } from '../scripts/translations.ts';
import { ged, parse, tempDir, Y } from './helpers.ts';

const TREE = ged(`
  0 @I1@ INDI
  1 NAME Petru /Stan/
  2 GIVN Petru
  2 SURN Stan
  1 BIRT
  2 DATE 1900
  1 DEAT
  2 DATE 1970
  2 CAUS Typhus
  1 NOTE Kept bees.
  1 FAMS @F1@
  0 @I2@ INDI
  1 NAME Sorin /Stan/
  2 GIVN Sorin
  2 SURN Stan
  1 BIRT
  2 DATE ${Y - 40}
  1 NOTE Lives near the station.
  1 FAMC @F1@
  0 @F1@ FAM
  1 HUSB @I1@
`);
const CONFIG = {
  settings: { livingPeople: 'initials', causeOfDeath: true },
  history: [{ cat: 'context', start: 1918, title: 'Great Union', text: '  1 December 1918.  ' }],
  noteEvents: [{ person: 'I2', year: Y - 20, title: 'Sorin moves away' }],
  surnames: { Stan: { meaning: 'From Stanislav.', changes: [{ when: '1800s', text: 'Became a family name.' }] } },
};

describe('contentStrings', () => {
  const strings = contentStrings(parse(TREE, CONFIG).data);

  test('lists the hand-written texts: history, notes, family names', () => {
    for (const s of ['Great Union', '1 December 1918.', 'Kept bees.', 'From Stanislav.', 'Became a family name.']) {
      assert.ok(strings.includes(s), `missing "${s}"`);
    }
  });
  test('leaves out the texts the parser builds (the page translates those itself)', () => {
    assert.ok(!strings.some(s => /^(Born|Died|Married)|^Cause: |^Year estimated /.test(s)), strings.join(' | '));
  });
  test('leaves out what is not on the page: a living person\'s notes and noteEvents', () => {
    assert.ok(!strings.includes('Lives near the station.'));
    assert.ok(!strings.includes('Sorin moves away'));
  });
  test('each text once, trimmed', () => {
    assert.equal(new Set(strings).size, strings.length);
    assert.ok(strings.every(s => s === s.trim() && s));
  });
});

describe('publishedTranslations', () => {
  const all = {
    ro: { 'Kept bees.': 'Ținea albine.', 'Lives near the station.': 'Locuiește lângă gară.', 'Great Union': '' },
    fr: { 'Kept bees.': 'Apiculteur, tél. 0721 123 456' },
    de: { 'Kept bees.': 'Hielt Bienen.' },
  };
  const out = publishedTranslations(all, ['Kept bees.', 'Great Union']);

  test('only texts on the page are published (a hidden note never ships through its translation)', () => {
    assert.deepEqual(out.ro, { 'Kept bees.': 'Ținea albine.' });
  });
  test('empty translations are left out', () => {
    assert.ok(!('Great Union' in out.ro!));
  });
  test('translations are scrubbed like the originals', () => {
    assert.deepEqual(out.fr, { 'Kept bees.': 'Apiculteur, tél. [number removed]' });
  });
  test('every page language is present; other languages are dropped', () => {
    assert.deepEqual(Object.keys(out).sort(), ['en', 'fr', 'pt', 'ro']);
    assert.deepEqual(out.en, {});
  });
});

describe('readTranslations', () => {
  test('a missing file is no translations', () => {
    assert.deepEqual(readTranslations(join(tempDir(), 'none.i18n.json')), {});
  });
  test('reads the file, with or without a byte order mark', () => {
    const path = join(tempDir(), 'tree.i18n.json');
    writeFileSync(path, '﻿{"ro":{"a":"b"}}');
    assert.deepEqual(readTranslations(path), { ro: { a: 'b' } });
  });
  test('the file sits next to the tree', () => {
    assert.equal(translationsPathFor('/x/data/tree.ged'), '/x/data/tree.i18n.json');
  });
});
