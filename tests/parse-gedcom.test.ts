/** Reading GEDCOM files (scripts/parse-gedcom.ts): lines, dates, HTML notes, scrubbing of free text, coordinates. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { __test, parseGedcom, readTree, scrub } from '../scripts/parse-gedcom.ts';
import { eventsOf, ged, parse, writeTree } from './helpers.ts';

const { splitLines, parseDate, unescapeHtml, cleanNote } = __test;

describe('scrub: emails and long numbers are removed from free text', () => {
  const removed: [string, string][] = [
    ['write to ion.pop@exemplu.ro today', 'write to [email removed] today'],
    ['ștefan.ă@exemplu.ro', '[email removed]'],
    ['call +40 721 123 456', 'call [number removed]'],
    ['call 0721-123-456 now', 'call [number removed] now'],
    ['tel. (0251) 412.345', 'tel. [number removed]'],
    ['CNP 1960314123456', 'CNP [number removed]'],
  ];
  for (const [input, out] of removed) test(JSON.stringify(input), () => assert.equal(scrub(input), out));

  const kept = [
    'born 12.03.1950 in Craiova',
    'served 1941-1945',
    'censuses of 1912 1930 1941',
    'house no. 12, room 4',
    'ref ABC123456789', // part of a word: an archive reference, not a phone number
    'between 1918 and 1920',
  ];
  for (const input of kept) test(`keeps ${JSON.stringify(input)}`, () => assert.equal(scrub(input), input));
});

describe('splitLines', () => {
  test('splits on CRLF, LF, CR and Unicode line breaks', () => {
    assert.deepEqual(splitLines('a\r\nb\nc\rd e f\x85g'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
  test('no empty line after a final newline, but empty lines inside are kept', () => {
    assert.deepEqual(splitLines('a\n\nb\n'), ['a', '', 'b']);
  });
});

describe('readTree', () => {
  test('builds records with their sub-lines and cross-reference ids', () => {
    const [head, indi] = readTree('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ion /Pop/\n2 GIVN Ion\n1 SEX M\n');
    assert.equal(head.tag, 'HEAD');
    assert.equal(indi.xref, '@I1@');
    assert.equal(indi.tag, 'INDI');
    assert.deepEqual(indi.kids.map(k => k.tag), ['NAME', 'SEX']);
    assert.equal(indi.kids[0].val, 'Ion /Pop/');
    assert.equal(indi.kids[0].kids[0].val, 'Ion');
  });
  test('reads CRLF files the same as LF files', () => {
    const lf = '0 @I1@ INDI\n1 NAME A /B/\n1 SEX F\n';
    assert.deepEqual(readTree(lf.replace(/\n/g, '\r\n')), readTree(lf));
  });
  test('a line without a level number continues the previous line (HTML notes)', () => {
    const [r] = readTree('0 @I1@ INDI\n1 NOTE <p>first\nsecond</p>\n1 SEX M\n');
    assert.equal(r.kids[0].val, '<p>first\nsecond</p>');
    assert.equal(r.kids[1].tag, 'SEX');
  });
  test('a sub-line before the first record is an error', () => {
    assert.throws(() => readTree('1 NAME A /B/\n'), /GEDCOM line before the first record/);
  });
});

describe('parseDate', () => {
  test('day, month and year precision', () => {
    assert.deepEqual(parseDate('12 FEB 1898'), { y: 1898, m: 2, d: 12, prec: 'day' });
    assert.deepEqual(parseDate('FEB 1898'), { y: 1898, m: 2, prec: 'month' });
    assert.deepEqual(parseDate('1898'), { y: 1898, prec: 'year' });
    assert.deepEqual(parseDate('  3   NOV  1965 '), { y: 1965, m: 11, d: 3, prec: 'day' });
  });
  test('no date', () => {
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate(''), null);
  });
  for (const s of ['ABT 1900', 'BET 1900 AND 1910', '31 FOO 1900', 'XX FEB 1900', 'FEB', '1 2 3 4']) {
    test(`"${s}" is an error`, () => assert.throws(() => parseDate(s), /Unsupported GEDCOM date/));
  }
  test('the error is reported from parseGedcom too', () => {
    assert.throws(() => parse(ged('0 @I1@ INDI\n1 BIRT\n2 DATE ABT 1900')), /Unsupported GEDCOM date "ABT 1900"/);
  });
});

describe('HTML notes', () => {
  test('named, decimal and hex entities', () => {
    assert.equal(unescapeHtml('Tom &amp; Jerry &lt;3'), 'Tom & Jerry <3');
    assert.equal(unescapeHtml('&#259;&#x219;&abreve;&Scedil;&tcedil;'), 'ășăŞţ');
    assert.equal(unescapeHtml('&eacute;t&eacute; &ndash; &bdquo;da&rdquo;'), 'été – „da”');
    assert.equal(unescapeHtml('a&nbsp;b'), 'a\xa0b');
  });
  test('unknown entities are kept; invalid code points become �', () => {
    assert.equal(unescapeHtml('&foo; &#xD800; &#0;'), '&foo; � �');
  });
  test('cleanNote drops tags, collapses spaces and scrubs', () => {
    assert.equal(cleanNote('<p>Hello&nbsp;<b>world</b></p>\n<p>mail: a@b.ro</p>'), 'Hello world mail: [email removed]');
  });
  test('notes, occupation and education reach the person\'s notes, cleaned', () => {
    const { data } = parse(ged(`
      0 @I1@ INDI
      1 NAME A /B/
      2 GIVN A
      1 BIRT
      2 DATE 1850
      1 OCCU Teacher, phone 0721 123 456
      1 EDUC Seminary
      1 NOTE <p>Moved to <i>Iași</i> &amp; back.</p>
    `));
    assert.deepEqual(data.people.I1.notes,
      ['Occupation: Teacher, phone [number removed]', 'Education / work: Seminary', 'Moved to Iași & back.']);
  });
});

describe('places', () => {
  test('coordinates from PLAC > MAP, with S and W as negative', () => {
    const { data } = parse(ged(`
      0 @I1@ INDI
      1 BIRT
      2 DATE 1850
      2 PLAC Lima, Peru
      3 MAP
      4 LATI S12.05
      4 LONG W77.04
    `));
    assert.deepEqual(data.places['Lima, Peru'], { label: 'Lima, Peru', lat: -12.05, lon: -77.04, approx: false });
  });
  test('a bad coordinate is an error', () => {
    assert.throws(() => parse(ged('0 @I1@ INDI\n1 BIRT\n2 PLAC X\n3 MAP\n4 LATI N4x\n4 LONG E1')), /Bad GEDCOM coordinate "N4x"/);
  });
  test('placeRules and config places match place names with or without diacritics', () => {
    const tree = ged(`
      0 @I1@ INDI
      1 BIRT
      2 DATE 1850
      2 PLAC Sat Tirgu Jiu, jud. Gorj
      0 @I2@ INDI
      1 BIRT
      2 DATE 1851
      2 PLAC Iasi
    `);
    const { data } = parse(tree, {
      places: { 'Târgu Jiu': { label: 'Târgu Jiu', lat: 45, lon: 23 }, 'Iași': { label: 'Iași', lat: 47, lon: 27 } },
      placeRules: [{ contains: 'Tîrgu Jiu', place: 'Târgu Jiu' }], // î folds to i; matching is case-sensitive
    });
    assert.equal(eventsOf(data, 'I1', 'birt')[0].place, 'Târgu Jiu');
    assert.equal(eventsOf(data, 'I2', 'birt')[0].place, 'Iași');
  });
});

describe('files', () => {
  test('a byte order mark at the start of the file is ignored', () => {
    const { data } = parseGedcom(writeTree('﻿' + ged('0 @I1@ INDI\n1 NAME A /B/\n2 GIVN A')));
    assert.equal(data.people.I1.given, 'A');
    assert.equal(data.tree?.program, 'Test exporter');
  });
  test('the config is read from <name>.config.json, and is optional', () => {
    const plain = parseGedcom(writeTree(ged('0 @I1@ INDI')));
    assert.equal(plain.configPath, null);
    const withCfg = parseGedcom(writeTree(ged('0 @I1@ INDI'), { settings: { historyLabel: 'Ardeal' } }));
    assert.match(withCfg.configPath!, /tree\.config\.json$/);
    assert.equal(withCfg.data.settings?.historyLabel, 'Ardeal');
  });
  test('the export program and date come from the header', () => {
    assert.deepEqual(parse(ged('0 @I1@ INDI')).data.tree, { program: 'Test exporter', exported: '4 NOV 2026' });
  });
});

describe('the demo tree', () => {
  const { data, summary } = parseGedcom(new URL('../demo/dummy.ged', import.meta.url).pathname);
  test('parses: 10 people, two branches', () => {
    assert.equal(Object.keys(data.people).length, 10);
    assert.deepEqual(data.branches, ['Marin', 'Popescu']);
    assert.match(summary[0], /^10 people;/);
  });
  test('an estimated birth year comes from the siblings', () => {
    // Vasile Popescu has a birth record with no date
    assert.equal(data.people.I5.byEst, true);
    assert.equal(eventsOf(data, 'I5', 'birt')[0].cat, 'plausible');
  });
});
