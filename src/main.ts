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
import { CLIPS, openClip, resetClips } from './clips';
import { createEventList } from './events';
import { createGlobe } from './globe';
import { L, lang, LANG_NAME, LANGS, setLang } from './i18n';
import type { Lang } from './i18n';
import { treeAbout } from './sources';
import { state, save } from './state';
import { createTimeline, FIRST_BIRTH } from './timeline';
import type { Category } from './types';
import { $, bcls, branchName, esc, injectBranchStyles, label } from './util';

injectBranchStyles();

/* ---------- the page's own words, in the chosen language (see index.html data-i18n) ---------- */
const word = (path: string) => {
  const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], L);
  return typeof v === 'string' ? v : path;
};
function translatePage() {
  document.title = L.title;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = word(el.dataset.i18n!); });
  document.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, path] = pair.split(':').map(s => s.trim());
      el.setAttribute(attr, word(path));
    }
  });
  $('stats').innerHTML = L.stats(people.length, BRANCHES.filter(b => b !== 'Other').length, `${FIRST_BIRTH}–${NOW}`, EV.length);
  [...branchSel.options].slice(1).forEach(o => { o.text = branchName(o.value); });
  $('privacy').textContent = [L.pEmails, L.pLiving[SET.livingPeople ?? 'full'],
    SET.causeOfDeath ? '' : L.pCauses, L.pFile(treeAbout())].filter(Boolean).join(' ');
  if (CLIPS.length) clipBtn.textContent = L.clips(CLIPS.length);
  if (!SURNAMES.length) $('surnames').innerHTML = `<span class="hint">${esc(L.noNames)}</span>`;
}

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

/* ---------- newspaper clippings: header button opens the viewer at the oldest one ---------- */
const clipBtn = $<HTMLButtonElement>('c-clips');
if (CLIPS.length) { clipBtn.hidden = false; clipBtn.onclick = () => openClip(); }

// the privacy note (in translatePage) says what this build left out
translatePage();

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
if (!SURNAMES.length) snBox.innerHTML = `<span class="hint">${esc(L.noNames)}</span>`;

/* ---------- language: everything the page writes itself is drawn again ---------- */
const langSel = $<HTMLSelectElement>('lang');
LANGS.forEach(l => langSel.add(new Option(LANG_NAME[l], l)));
langSel.value = lang;
langSel.onchange = () => {
  setLang(langSel.value as Lang);
  translatePage();
  resetClips();
  card.refresh();
  timeline.rebuild();
  events.rebuild();
  globe.drawPins();
};

globe.drawPins();
// opening event: config startEvent (title prefix), else the first plausible history event, else the first event
const first = (SET.startEvent && EV.find(e => e.title.startsWith(SET.startEvent!)))
  || EV.find(e => e.kind === 'history' && e.cat === 'plausible') || EV[0];
if (first) card.showEvent(first.id);
