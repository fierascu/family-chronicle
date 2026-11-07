import { EV, HISTORY_LABEL, NOW, P, PL, relatives } from './data';
import { visibleEvents } from './globe';
import { state } from './state';
import { CAT_LABEL, esc, fmt, label, swatch } from './util';
import type { ChronicleEvent } from './types';

export interface CardView {
  showPerson(id: string): void;
  showEvent(id: string): void;
  showPlace(key: string): void;
}

function evRow(e: ChronicleEvent, clickable = false) {
  const pl = e.place ? ` · ${esc(PL[e.place]?.label || e.place)}` : '';
  const yr = e.kind === 'history' ? (e.end && e.end > e.date.y ? `${e.date.y}–${String(e.end).slice(2)}` : e.date.y) : fmt(e.date);
  const pid = clickable && e.person ? ` data-pid="${esc(e.person)}" style="cursor:pointer"` : '';
  const link = e.kind === 'history' && e.link ? e.link : '';
  return `<li><span class="yr">${yr}</span><span class="g ${e.cat}" title="${CAT_LABEL[e.cat]}"></span><div>
    <div class="t"${pid}>${esc(e.title)}<span class="x">${pl}</span></div>${e.text ? `<div class="x">${esc(e.text)}</div>` : ''}
    ${link ? `<div class="x"><a href="${esc(link)}" target="_blank" rel="noopener">Read more ↗</a></div>` : ''}</div></li>`;
}

const relButtons = (ids: (string | undefined)[]) =>
  ids.filter((id): id is string => !!id && !!P[id])
    .map(id => `<button data-pid="${esc(id)}">${esc(label(P[id]))}</button>`).join('');

export function createCard(
  card: HTMLElement,
  on: { personShown(id: string): void; changed(): void },
): CardView {
  /** buttons and rows with data-pid open that person */
  function wire() {
    card.querySelectorAll<HTMLElement>('[data-pid]').forEach(b => {
      b.onclick = () => { showPerson(b.dataset.pid!); on.personShown(b.dataset.pid!); };
    });
  }

  function showPerson(id: string) {
    const p = P[id];
    state.sel = id;
    const own = EV.filter(e => e.kind === 'family' && (e.person === id || e.partner === id));
    const hist = EV.filter(e => e.kind === 'history' && e.people.includes(id));
    const life = p.by ? EV.filter(e => e.kind === 'history' && e.cat === 'context' && (e.end || e.date.y) >= p.by!
      && e.date.y <= (p.dy || NOW) && !e.people.includes(id)).length : 0;
    const evs = [...own, ...hist].filter(e => state.cats.has(e.cat)).sort((a, b) => a.date.y - b.date.y);
    const f = relatives(p);
    const sec = (t: string, ids: (string | undefined)[]) => {
      const btns = relButtons(ids);
      return btns ? `<div><div class="eyebrow">${t}</div><div class="rel" style="margin-top:5px">${btns}</div></div>` : '';
    };
    card.innerHTML = `<div><div class="eyebrow">${swatch(p.branch)}${esc(p.branch)} branch</div><h3>${esc(label(p))}</h3>
      <div class="meta">${p.by ? (p.byEst ? 'c. ' : '') + p.by : '?'} – ${p.dy || (p.dead ? '?' : '')}${p.living ? ' · may be living' : ''}</div></div>
      ${evs.length ? `<ul class="evlist">${evs.map(e => evRow(e)).join('')}</ul>` : `<p class="empty">No events with a date or place yet.</p>`}
      ${p.notes.length ? `<div><div class="eyebrow">Notes from the tree</div><p class="x" style="margin:4px 0 0">${p.notes.map(esc).join('<br>')}</p></div>` : ''}
      ${life ? `<p class="hint" style="margin:0">${life} context events fall within this lifetime. They show on the ${esc(HISTORY_LABEL)} row of the timeline.</p>` : ''}
      ${sec('Parents', f.parents)}${sec('Spouses', f.spouses)}${sec('Children', f.kids)}${sec('Siblings', f.sibs)}`;
    wire();
    on.changed();
  }

  function showEvent(id: string) {
    const e = EV.find(x => x.id === id);
    if (!e) return;
    if (e.kind === 'family') { showPerson(e.person); return; }
    state.sel = null;
    const who = relButtons(e.people);
    card.innerHTML = `<div><div class="eyebrow">${CAT_LABEL[e.cat]} · history</div><h3>${esc(e.title)}</h3>
      <div class="meta">${e.date.y}${e.end ? '–' + e.end : ''}${e.place ? ' · ' + esc(PL[e.place]?.label || e.place) : ''}</div></div>
      <p style="margin:0">${esc(e.text)}</p>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">Read more ↗</a>` : ''}
      ${who ? `<div><div class="eyebrow">Relatives this may concern</div><div class="rel" style="margin-top:5px">${who}</div></div>` : ''}`;
    wire();
    on.changed();
  }

  function showPlace(k: string) {
    const evs = visibleEvents().filter(e => e.place === k).sort((a, b) => a.date.y - b.date.y);
    const pl = PL[k];
    card.innerHTML = `<div><div class="eyebrow">Place · ${state.win[0]}–${state.win[1]}</div><h3>${esc(pl.label)}</h3>
      <div class="meta">${pl.lat.toFixed(2)}° N, ${pl.lon.toFixed(2)}° E${pl.approx ? ' · approximate location' : ''}</div></div>
      <ul class="evlist">${evs.map(e => evRow(e, true)).join('')}</ul>`;
    wire();
  }

  return { showPerson, showEvent, showPlace };
}
