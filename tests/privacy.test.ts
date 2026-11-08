/**
 * Privacy rules of scripts/parse-gedcom.ts: what reaches the page (`data`) about living people,
 * in each `settings.livingPeople` mode. Everything in `data` is bundled into the page.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { eventTitled, eventsOf, ged, parse, Y } from './helpers.ts';

// Toma (no dates) is the father of Petru (b. 1900): his estimated birth year makes him not living.
// Sorin Stan and his wife Tudora Vlad are living; Vlad is carried only by her, so it is a living-only surname.
// Mihai Rusu has no dates and no relatives: counted as living. Ilie Dobre was born 101 years ago, no death record.
const TREE = ged(`
  0 @I10@ INDI
  1 NAME Toma /Stan/
  2 GIVN Toma
  2 SURN Stan
  1 SEX M
  1 FAMS @F0@
  0 @I1@ INDI
  1 NAME Petru /Stan/
  2 GIVN Petru
  2 SURN Stan
  1 SEX M
  1 BIRT
  2 DATE 12 FEB 1900
  2 PLAC Satul Mic, str. Florilor 3
  1 DEAT
  2 DATE 1970
  2 PLAC Cluj
  2 CAUS Typhus
  1 FAMC @F0@
  1 FAMS @F1@
  0 @I2@ INDI
  1 NAME Ilinca /Lupu/
  2 GIVN Ilinca
  2 SURN Lupu
  2 _MARNM Stan
  1 SEX F
  1 BIRT
  2 DATE 1905
  1 DEAT
  2 DATE 1980
  1 FAMS @F1@
  0 @I3@ INDI
  1 NAME Sorin /Stan/
  2 GIVN Sorin
  2 SURN Stan
  1 SEX M
  1 BIRT
  2 DATE 3 JUN ${Y - 40}
  2 PLAC Brașov
  1 OCCU Pilot
  1 NOTE Lives at Strada Lungă, near the station.
  1 FAMC @F1@
  1 FAMS @F2@
  0 @I4@ INDI
  1 NAME Tudora /Vlad/
  2 GIVN Tudora
  2 SURN Vlad
  1 SEX F
  1 BIRT
  2 DATE ${Y - 38}
  1 FAMS @F2@
  0 @I5@ INDI
  1 NAME Mihai /Rusu/
  2 GIVN Mihai
  2 SURN Rusu
  1 SEX M
  0 @I6@ INDI
  1 NAME Ilie /Dobre/
  2 GIVN Ilie
  2 SURN Dobre
  1 SEX M
  1 BIRT
  2 DATE ${Y - 101}
  0 @F0@ FAM
  1 HUSB @I10@
  1 CHIL @I1@
  0 @F1@ FAM
  1 HUSB @I1@
  1 WIFE @I2@
  1 CHIL @I3@
  1 MARR
  2 DATE 1 MAY 1925
  2 PLAC Cluj
  0 @F2@ FAM
  1 HUSB @I3@
  1 WIFE @I4@
  1 MARR
  2 DATE 12 MAY ${Y - 10}
  2 PLAC Brașov
`);

const CONFIG = (livingPeople?: string, more: Record<string, unknown> = {}) => ({
  settings: { ...(livingPeople ? { livingPeople } : {}), ...more },
  places: {
    Cluj: { label: 'Cluj', lat: 46.77, lon: 23.6 },
    Brașov: { label: 'Brașov', lat: 45.65, lon: 25.6 },
  },
  noteEvents: [
    { person: 'I3', year: Y - 20, title: 'Sorin learns to fly', text: 'Flight school in Brașov.' },
    { person: 'I1', year: 1930, title: 'Petru buys a mill', text: 'From the notes.' },
  ],
});

/** texts about the living people that must never be in `data` when they are protected */
const LIVING_DETAILS = ['Sorin', 'Tudora', 'Vlad', 'Pilot', 'Strada', 'Brașov', 'learns to fly', 'Flight school'];

describe('who counts as living', () => {
  const { data } = parse(TREE, CONFIG('initials'));
  const living = (id: string) => data.people[id].living;

  test('no death record and born within the last 100 years', () => {
    assert.equal(living('I3'), true);
    assert.equal(living('I4'), true);
  });
  test('a death record makes a person not living', () => {
    assert.equal(living('I1'), false);
    assert.equal(data.people.I1.dead, true);
  });
  test('no birth date and no relatives to estimate it from: living', () => {
    assert.equal(living('I5'), true);
  });
  test('born more than 100 years ago, no death record: not living', () => {
    assert.equal(living('I6'), false);
  });
  test('an estimated birth year counts: the father of a child born in 1900 is not living', () => {
    assert.equal(data.people.I10.by, 1873);
    assert.equal(data.people.I10.byEst, true);
    assert.equal(living('I10'), false);
  });
  test('the 100-year limit is inclusive', () => {
    const at = (y: number) => parse(ged(`0 @I1@ INDI\n1 NAME A /B/\n2 GIVN A\n1 BIRT\n2 DATE ${y}`)).data.people.I1.living;
    assert.equal(at(Y - 100), true);
    assert.equal(at(Y - 101), false);
  });
  test('settings.livingYears changes the limit', () => {
    const { data } = parse(TREE, CONFIG('initials', { livingYears: 39 }));
    assert.equal(data.people.I3.living, false); // born 40 years ago
    assert.equal(data.people.I4.living, true); // born 38 years ago
  });
});

describe('livingPeople: "initials"', () => {
  const { data } = parse(TREE, CONFIG('initials'));
  const json = JSON.stringify(data);

  test('names are reduced to initials', () => {
    const p = data.people.I3;
    assert.equal(p.name, 'S. S.');
    assert.equal(p.given, 'S.');
    assert.equal(p.surname, 'S.');
  });
  test('no notes and no places for living people', () => {
    assert.deepEqual(data.people.I3.notes, []);
    assert.equal(data.people.I3.bp, null);
    assert.equal(data.people.I3.dp, null);
  });
  test('the birth of a living person shows only the year, with no place', () => {
    const [birth] = eventsOf(data, 'I3', 'birt');
    assert.deepEqual(birth.date, { y: Y - 40, prec: 'year' });
    assert.equal(birth.place, null);
    assert.equal(birth.title, 'Born: S. S.');
  });
  test('a marriage with a living spouse shows only the year, with no place', () => {
    const marr = eventTitled(data, 'Married: S. S. & T. V.');
    assert.ok(marr, 'marriage event is published under initials');
    assert.deepEqual(marr.date, { y: Y - 10, prec: 'year' });
    assert.equal(marr.place, null);
  });
  test('a marriage of two dead people keeps its full date and place', () => {
    const marr = eventTitled(data, 'Married: Petru Stan & Ilinca Lupu');
    assert.deepEqual(marr?.date, { y: 1925, m: 5, d: 1, prec: 'day' });
    assert.equal(marr?.place, 'Cluj');
  });
  test('config noteEvents about a living person are left out; others are kept', () => {
    assert.equal(eventTitled(data, 'Sorin learns to fly'), undefined);
    assert.ok(eventTitled(data, 'Petru buys a mill'));
  });
  test('a branch made only of living people does not use their surname', () => {
    assert.ok(!data.branches?.includes('Vlad'));
    assert.equal(data.people.I4.branch, 'Other');
    assert.equal(data.people.I3.branch, 'Stan');
  });
  test('a surname carried only by living people is not published', () => {
    const names = data.surnames!.map(s => s.name);
    assert.ok(!names.includes('Vlad'));
    assert.ok(names.includes('Stan'));
  });
  test('a living person joins a published surname, without adding a spelling or birth year', () => {
    const stan = data.surnames!.find(s => s.name === 'Stan')!;
    assert.ok(stan.people.includes('I3'));
    assert.deepEqual(stan.spellings, [{ spelling: 'Stan', from: 1873 }]);
  });
  test('places only a living person used are not published', () => {
    assert.ok(!('Brașov' in data.places));
    assert.ok('Cluj' in data.places);
  });
  test('nothing about the living people appears anywhere in the data', () => {
    for (const s of LIVING_DETAILS) assert.ok(!json.includes(s), `"${s}" is in the published data`);
  });
  test('the dead are published in full', () => {
    assert.equal(data.people.I1.name, 'Petru Stan');
    assert.ok(eventTitled(data, 'Born: Petru Stan'));
  });
});

describe('livingPeople: "hidden"', () => {
  const { data } = parse(TREE, CONFIG('hidden'));

  test('living people are shown as "Living person", with no initials', () => {
    const p = data.people.I3;
    assert.equal(p.name, 'Living person');
    assert.equal(p.given, 'Living person');
    assert.equal(p.surname, '');
    assert.equal(p.married, '');
    assert.ok(eventTitled(data, 'Married: Living person & Living person'));
  });
  test('nothing about the living people appears anywhere in the data', () => {
    const json = JSON.stringify(data);
    for (const s of [...LIVING_DETAILS, 'S. S.']) assert.ok(!json.includes(s), `"${s}" is in the published data`);
  });
});

describe('livingPeople: "full"', () => {
  test('is the default when the config does not set it', () => {
    const { data } = parse(TREE, CONFIG());
    assert.equal(data.settings?.livingPeople, 'full');
    assert.equal(data.people.I3.name, 'Sorin Stan');
  });
  test('publishes names and notes, but a living person\'s birth still shows only the year', () => {
    const { data } = parse(TREE, CONFIG('full'));
    assert.equal(data.people.I3.name, 'Sorin Stan');
    assert.ok(data.people.I3.notes.some(n => n.includes('Strada Lungă')));
    assert.deepEqual(eventsOf(data, 'I3', 'birt')[0].date, { y: Y - 40, prec: 'year' });
    assert.ok(eventTitled(data, 'Sorin learns to fly'));
    assert.ok(data.branches?.includes('Vlad'));
  });
});

test('an unknown livingPeople value is an error', () => {
  assert.throws(() => parse(TREE, CONFIG('everyone')), /settings\.livingPeople must be "initials", "hidden" or "full"/);
});

describe('other private details', () => {
  test('cause of death is left out unless settings.causeOfDeath is true', () => {
    const death = (cfg: object) => eventsOf(parse(TREE, cfg).data, 'I1', 'deat')[0];
    assert.equal(death(CONFIG('initials')).text, '');
    assert.equal(death(CONFIG('initials', { causeOfDeath: true })).text, 'Cause: Typhus');
  });
  test('place names as typed in the tree are not published when they have no map location', () => {
    const { data, report } = parse(TREE, CONFIG('initials'));
    assert.equal(eventsOf(data, 'I1', 'birt')[0].place, null);
    assert.ok(!JSON.stringify(data).includes('Florilor'));
    assert.ok(report.some(c => c.includes('Satul Mic, str. Florilor 3')), 'listed for the owner in checks.txt');
  });
});

describe('data checks: report versus page', () => {
  test('the checks go to the report; the page gets none by default', () => {
    const { data, report } = parse(TREE, CONFIG('initials'));
    assert.deepEqual(data.checks, []);
    assert.ok(report.some(c => c.includes('family names have no "about" text yet')));
  });
  test('with checksOnPage, the page gets checks without living people\'s names', () => {
    const { data } = parse(TREE, CONFIG('initials', { checksOnPage: true }));
    assert.ok(data.checks.length > 0);
    const text = data.checks.join('\n');
    for (const s of LIVING_DETAILS) assert.ok(!text.includes(s), `"${s}" is in the checks on the page`);
  });
  test('possible duplicates of living people are not named on the page', () => {
    const twins = ged(`
      0 @I1@ INDI
      1 NAME Ana /Pop/
      2 GIVN Ana
      2 SURN Pop
      1 BIRT
      2 DATE ${Y - 30}
      0 @I2@ INDI
      1 NAME Ana /Pop/
      2 GIVN Ana
      2 SURN Pop
      1 BIRT
      2 DATE ${Y - 31}
    `);
    const { data, report } = parse(twins, { settings: { livingPeople: 'initials', checksOnPage: true } });
    assert.ok(report.some(c => c.startsWith('2 people named Ana Pop')));
    assert.ok(!data.checks.some(c => c.includes('people named')));
  });
});
