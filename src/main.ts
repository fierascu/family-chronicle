// Only the Latin subsets: enough for Romanian (ă â î ș ț) and other European names
import '@fontsource/alegreya/latin-500.css';
import '@fontsource/alegreya/latin-ext-500.css';
import '@fontsource/alegreya/latin-700.css';
import '@fontsource/alegreya/latin-ext-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-ext-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-ext-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import './style.css';

import { BRANCHES, CHECKS, EV, NOW, SET, SURNAMES, people } from './data';
import { createCard } from './card';
import { CLIPS, openClip } from './clips';
import { createEventList } from './events';
import { createGlobe } from './globe';
import { treeAbout } from './sources';
import { state, save } from './state';
import { createTimeline, FIRST_BIRTH } from './timeline';
import type { Category } from './types';
import { $, bcls, esc, injectBranchStyles, label } from './util';

injectBranchStyles();

/* ---------- header ---------- */
$('stats').innerHTML = `<b>${people.length}</b> people · <b>${BRANCHES.filter(b => b !== 'Other').length}</b> branches · `
  + `<b>${FIRST_BIRTH}–${NOW}</b> · <b>${EV.length}</b> events`;

const branchSel = $<HTMLSelectElement>('branch');
BRANCHES.forEach(b => branchSel.add(new Option(b, b)));
if (!BRANCHES.includes(state.branch)) state.branch = ''; // stored branch from another tree
branchSel.value = state.branch;
const branchSw = $('branch-sw');
const syncBranchSw = () => { branchSw.className = 'sw ' + bcls(state.branch); branchSw.hidden = !state.branch; };
syncBranchSw();

$('names').innerHTML = people.filter(p => p.given && p.given !== '?').map(p => `<option value="${esc(label(p))}">`).join('');
$('checks').innerHTML = CHECKS.map(c => `<li>${esc(c)}</li>`).join('');
$('checks-panel').hidden = !CHECKS.length; // the list is only on the page with settings.checksOnPage

/* ---------- privacy note: says what this build left out ---------- */
const living = {
  initials: 'People who may be living are shown by their initials, with their birth year only: no places, notes or exact marriage dates.',
  hidden: 'People who may be living are shown as "Living person", with their birth year only: no places, notes or exact marriage dates.',
  full: 'People who may be living are shown by name, with their birth year only. Share this page only behind a password.',
}[SET.livingPeople ?? 'full'];
$('privacy').textContent = ['Email addresses and phone numbers are removed from the notes.', living,
  SET.causeOfDeath ? '' : 'Causes of death are not shown.',
  `${treeAbout()}; the file itself is not published.`].filter(Boolean).join(' ');
/* ---------- newspaper clippings: header button opens the viewer at the oldest one ---------- */
const clipBtn = $<HTMLButtonElement>('c-clips');
if (CLIPS.length) { clipBtn.hidden = false; clipBtn.textContent = `Newspaper clippings (${CLIPS.length})`; clipBtn.onclick = () => openClip(); }

const chips = document.querySelectorAll<HTMLButtonElement>('.chip[data-cat]');
chips.forEach(b => b.setAttribute('aria-pressed', String(state.cats.has(b.dataset.cat as Category))));

/* ---------- record card: under the big panel; scrolled into view (only as far as needed) when opened ---------- */
const reveal = () => $('card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

/* ---------- views ---------- */
// created in this order so no callback can run before the view it calls exists
const globe = createGlobe($<HTMLCanvasElement>('globe-canvas'), $('map') as unknown as SVGSVGElement, $('span'), {
  place: k => { card.showPlace(k); reveal(); },
});
$('z-in').onclick = () => globe.zoomIn();
$('z-out').onclick = () => globe.zoomOut();
$('z-home').onclick = () => globe.reset();
const card = createCard($('card'), {
  personShown: id => timeline.focusPerson(id),
  changed: () => { if (state.sel) timeline.select(state.sel); globe.drawPins(); },
});
const timeline = createTimeline($('tl'), {
  person: id => { card.showPerson(id); reveal(); },
  event: id => { card.showEvent(id); reveal(); },
  range: () => globe.drawPins(),
});
$('tl').querySelector('.loading')?.remove();
const events = createEventList($('events'), {
  event: id => {
    card.showEvent(id);
    const ev = EV.find(e => e.id === id);
    if (ev?.kind === 'family') timeline.focusPerson(ev.person);
    reveal();
  },
});

/* ---------- controls ---------- */
const refresh = () => { save(); timeline.rebuild(); globe.drawPins(); events.rebuild(); };
chips.forEach(b => b.onclick = () => {
  const c = b.dataset.cat as Category;
  if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
  b.setAttribute('aria-pressed', String(state.cats.has(c)));
  refresh();
});
branchSel.onchange = () => { state.branch = branchSel.value; syncBranchSw(); refresh(); };
$<HTMLInputElement>('q').addEventListener('change', ev => {
  const v = (ev.target as HTMLInputElement).value.trim().toLowerCase();
  if (!v) return;
  const p = people.find(p => label(p).toLowerCase() === v) || people.find(p => label(p).toLowerCase().includes(v));
  if (!p) return;
  if (state.branch && p.branch !== state.branch) {
    state.branch = ''; branchSel.value = ''; syncBranchSw(); timeline.rebuild(); events.rebuild();
  }
  card.showPerson(p.id);
  timeline.focusPerson(p.id);
  reveal();
});


/* ---------- History row toggle ---------- */
const histBtn = $<HTMLButtonElement>('hist-toggle');
histBtn.setAttribute('aria-pressed', String(state.hist));
histBtn.onclick = () => {
  state.hist = !state.hist;
  histBtn.setAttribute('aria-pressed', String(state.hist));
  timeline.rebuild();
};

/* ---------- category legend: closed under the big panel; "?" opens it ---------- */
const legend = $<HTMLDetailsElement>('legend');
$('help').onclick = () => {
  legend.open = !legend.open;
  if (legend.open) legend.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/* ---------- tabs: Timeline, Events, Places ---------- */
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
function showTab(name: typeof state.tab, focus = false) {
  state.tab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
    if (on && focus) t.focus();
  }
  if (name === 'timeline') timeline.redraw();
  if (name === 'places') globe.drawPins();
  save();
}
tabs.forEach((t, i) => {
  t.onclick = () => showTab(t.dataset.tab as typeof state.tab);
  t.onkeydown = ev => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    showTab(tabs[(i + step + tabs.length) % tabs.length].dataset.tab as typeof state.tab, true);
  };
});
showTab(state.tab);

/* ---------- family names ---------- */
const snBox = $('surnames');
for (const s of SURNAMES) {
  const b = document.createElement('button');
  b.textContent = `${s.name} (${s.people.length})`;
  b.onclick = () => { card.showSurname(s.name); reveal(); };
  snBox.append(b);
}
if (!SURNAMES.length) snBox.innerHTML = '<span class="hint">No family names in the tree.</span>';

globe.drawPins();
// opening event: config startEvent (title prefix), else the first plausible history event, else the first event
const first = (SET.startEvent && EV.find(e => e.title.startsWith(SET.startEvent!)))
  || EV.find(e => e.kind === 'history' && e.cat === 'plausible') || EV[0];
if (first) card.showEvent(first.id);
