/** src/find.ts fuzzy matching: spellings that differ a little find the same name, different names stay apart. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { close, closestPerson, closestSurname, distance, fuzzyIncludes, nameDistance, spell } from '../src/find.ts';
import type { SurnameInfo } from '../src/types.ts';
import { ged, parse } from './helpers.ts';

describe('spell', () => {
  test('â and î, cedilla and comma letters are one spelling', () => {
    assert.equal(spell('Câmpeanu'), spell('Cîmpeanu'));
    assert.equal(spell('Fieraşcu'), spell('Fierășcu'));
    assert.equal(spell('Fieraşcu'), 'fierascu');
  });
  test('k/c, gh/g, double letters, y/i, w/v', () => {
    assert.equal(spell('Kostache'), spell('Costache'));
    assert.equal(spell('Gheorghe'), spell('George'));
    assert.equal(spell('Annna'), 'ana');
    assert.equal(spell('Wasyl'), spell('Vasil'));
  });
});

test('distance counts a swap as one', () => {
  assert.equal(distance('ion', 'ion'), 0);
  assert.equal(distance('ion', 'ioan'), 1);
  assert.equal(distance('popescu', 'poepscu'), 1);
  assert.equal(distance('abc', ''), 3);
});

describe('close', () => {
  for (const [a, b] of [['Popescu', 'Popesco'], ['Ion', 'Ioan'], ['Fierăscu', 'Fierascu'], ['Ionescu', 'Ionesu'],
    ['Constantin', 'Costantin'], ['Ștefănescu', 'Stefanesku'], ['Mihai', 'Mihail']])
    test(`${a} ~ ${b}`, () => assert.ok(close(a, b)));
  for (const [a, b] of [['Ion', 'Dan'], ['Ion', 'Ina'], ['Popescu', 'Popovici'], ['Ana', 'Ioana'], ['Stefanescu', 'Stefanachi'],
    ['Al', 'Ai'], ['Ionescu', 'Popescu']])
    test(`${a} ≁ ${b}`, () => assert.ok(!close(a, b)));
});

describe('nameDistance', () => {
  test('every typed word needs its own close word in the name', () => {
    assert.equal(nameDistance('Ioan Popesco', 'Ion Popescu'), 2);
    assert.equal(nameDistance('popscu', 'Ion Popescu'), 1);
    assert.equal(nameDistance('Ion Ion', 'Ion Popescu'), undefined);
    assert.equal(nameDistance('Ion Popescu Extra', 'Ion Popescu'), undefined);
    assert.equal(nameDistance('', 'Ion Popescu'), undefined);
  });
});

describe('closestPerson', () => {
  const PEOPLE = [{ id: 'I1', name: 'Ion Popescu' }, { id: 'I2', name: 'Ioana Popescu' }, { id: 'I3', name: 'Maria Ionescu' }];
  const find = (t: string) => closestPerson(PEOPLE, p => p.name, t)?.id;
  test('the closest spelling wins', () => {
    assert.equal(find('Ioan Popesco'), 'I1');
    assert.equal(find('Ioanna Popescu'), 'I2');
    assert.equal(find('Marya Ionesco'), 'I3');
  });
  test('nothing close is undefined', () => assert.equal(find('Gheorghe Vasilescu'), undefined));
});

describe('closestSurname', () => {
  const s = (name: string, variants?: string[]): SurnameInfo => ({ name, people: [], spellings: [], variants });
  const SURNAMES = [s('Popescu', ['Popesco']), s('Fierăscu'), s('Ionescu')];
  test('a near spelling of the name or a variant', () => {
    assert.equal(closestSurname(SURNAMES, 'Popeskou')?.name, 'Popescu');
    assert.equal(closestSurname(SURNAMES, 'Fierascu')?.name, 'Fierăscu');
    assert.equal(closestSurname(SURNAMES, 'Ionesco')?.name, 'Ionescu');
  });
  test('more than one word is a person, not a family name', () => assert.equal(closestSurname(SURNAMES, 'Ion Popescu'), undefined));
  test('nothing close is undefined', () => assert.equal(closestSurname(SURNAMES, 'Vasilescu'), undefined));
});

describe('fuzzyIncludes (events filter)', () => {
  const hay = 'birth of ion popescu craiova 1898';
  test('exact words, parts of words and close spellings', () => {
    assert.ok(fuzzyIncludes(['popesco', '1898'], hay));
    assert.ok(fuzzyIncludes(['ioan', 'craiova'], hay));
    assert.ok(fuzzyIncludes(['crai'], hay));
  });
  test('every word must be found', () => assert.ok(!fuzzyIncludes(['popesco', 'bucuresti'], hay)));
  test('short words only match exactly', () => assert.ok(!fuzzyIncludes(['xx'], hay)));
});

describe('data checks: names spelled almost the same', () => {
  const person = (id: string, name: string, sex: string, born: number, famc = '') => `
    0 @${id}@ INDI
    1 NAME ${name}
    2 GIVN ${name.split(' /')[0]}
    2 SURN ${name.split('/')[1]}
    1 SEX ${sex}
    1 BIRT
    2 DATE ${born}
    ${famc ? `1 FAMC @${famc}@` : ''}
    1 DEAT
    2 DATE 1950`;
  const report = (body: string) => parse(ged(body)).report.join('\n');
  test('Ioan / Ion Popescu born a year apart are flagged', () => {
    const r = report(person('I1', 'Ion /Popescu/', 'M', 1890) + person('I2', 'Ioan /Popesco/', 'M', 1891));
    assert.match(r, /Ion Popescu \(born 1890\) and Ioan Popesco \(born 1891\) have names spelled almost the same/);
  });
  test('not when born far apart, of different sex, siblings, or different names', () => {
    for (const body of [
      person('I1', 'Ion /Popescu/', 'M', 1890) + person('I2', 'Ioan /Popescu/', 'M', 1920),
      person('I1', 'Marian /Popescu/', 'M', 1890) + person('I2', 'Maria /Popescu/', 'F', 1890),
      person('I1', 'Ion /Popescu/', 'M', 1890, 'F1') + person('I2', 'Ioan /Popescu/', 'M', 1891, 'F1')
        + '\n0 @F1@ FAM\n1 CHIL @I1@\n1 CHIL @I2@',
      person('I1', 'Ion /Popescu/', 'M', 1890) + person('I2', 'Dan /Popescu/', 'M', 1890),
    ]) assert.doesNotMatch(report(body), /spelled almost the same/);
  });
});
