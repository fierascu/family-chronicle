/** src/find.ts: what ?name= / ?search= in the address, and the search box, open. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fold, matchPerson, matchSurname, nameParam } from '../src/find.ts';
import type { SurnameInfo } from '../src/types.ts';

const surname = (name: string, variants?: string[]): SurnameInfo => ({ name, people: [], spellings: [], variants });
const SURNAMES = [surname('Popescu', ['Popesco']), surname('Ștefănescu')];

const PEOPLE = [{ id: 'I1', name: 'Ion Popescu' }, { id: 'I2', name: 'Maria Ionescu' }, { id: 'I3', name: 'Ion' }];
const find = (text: string) => matchPerson(PEOPLE, p => p.name, text)?.id;

describe('nameParam', () => {
  test('reads ?name= next to ?lang=', () => assert.equal(nameParam('?lang=ro&name=Popescu'), 'Popescu'));
  test('?search= works too', () => assert.equal(nameParam('?search=Popescu'), 'Popescu'));
  test('?name= wins over ?search=', () => assert.equal(nameParam('?search=A&name=B'), 'B'));
  test('decodes spaces and accents', () => {
    assert.equal(nameParam('?name=Ion+Popescu'), 'Ion Popescu');
    assert.equal(nameParam('?name=%C8%98tef%C4%83nescu'), 'Ștefănescu');
  });
  test('missing or blank is undefined', () => {
    assert.equal(nameParam('?lang=ro'), undefined);
    assert.equal(nameParam('?name=%20'), undefined);
    assert.equal(nameParam(''), undefined);
  });
});

describe('matchSurname', () => {
  test('case and accents are ignored', () => {
    assert.equal(matchSurname(SURNAMES, 'popescu')?.name, 'Popescu');
    assert.equal(matchSurname(SURNAMES, 'STEFANESCU')?.name, 'Ștefănescu');
  });
  test('a configured variant opens the family name', () => assert.equal(matchSurname(SURNAMES, 'Popesco')?.name, 'Popescu'));
  test('only whole names match, so a person search can take over', () => {
    assert.equal(matchSurname(SURNAMES, 'Pop'), undefined);
    assert.equal(matchSurname(SURNAMES, 'Ion Popescu'), undefined);
    assert.equal(matchSurname(SURNAMES, ''), undefined);
  });
});

describe('matchPerson', () => {
  test('an exact name wins over an earlier partial match', () => assert.equal(find('ion'), 'I3'));
  test('else the first name containing the text', () => assert.equal(find('Ionescu'), 'I2'));
  test('case, accents and surrounding spaces are ignored', () => assert.equal(find('  ÎON POPESCU '), 'I1'));
  test('no match, or nothing typed, is undefined', () => {
    assert.equal(find('Zzz'), undefined);
    assert.equal(find('  '), undefined);
  });
});

test('fold strips Romanian diacritics', () => assert.equal(fold('Ăă Ââ Îî Șș Țț'), 'aa aa ii ss tt'));
