import { render } from 'preact';
import { useState } from 'preact/hooks';
import { EV, P, PL } from './data';
import { evTitle, L, lang, locale } from './i18n';
import { sourceOf } from './sources';
import type { EventSource } from './sources';
import { state } from './state';
import { fold } from './find';
import { fmt, label } from './util';
import type { ChronicleEvent } from './types';

export interface EventListView {
  /** re-apply the category and branch filters, or the language */
  rebuild(): void;
}

/** lower case, without diacritics, so "fierascu" finds "Fierăscu" */

const peopleOf = (e: ChronicleEvent) =>
  (e.kind === 'family' ? [e.person, e.partner] : e.people).filter((id): id is string => !!id && !!P[id]);

export const when = (e: ChronicleEvent) =>
  e.kind === 'history' ? (e.end && e.end > e.date.y ? `${e.date.y}–${e.end}` : String(e.date.y)) : fmt(e.date);

/** sort key: year, month, day; an estimated or year-only date sorts at the start of its year */
const key = (e: ChronicleEvent) => e.date.y * 10000 + (e.date.m ?? 0) * 100 + (e.date.d ?? 0);

/** sources and search text depend on the language, so they are worked out again when it changes */
let forLang = '';
let SRC = new Map<string, EventSource>();
let HAY = new Map<string, string>();
function index() {
  if (forLang === lang) return;
  forLang = lang;
  SRC = new Map(EV.map(e => [e.id, sourceOf(e)]));
  // everything the search box matches against, folded once; both the shown and the original title
  HAY = new Map(EV.map(e => [e.id, fold([
    evTitle(e), e.title, when(e), e.place ? PL[e.place]?.label ?? e.place : '', ...peopleOf(e).map(id => label(P[id])),
    SRC.get(e.id)!.label,
  ].join(' '))]));
}

const MAX_NAMES = 3;

type SortBy = 'date' | 'source';

/** a column header that sorts: a click sorts by it, a second click reverses */
function SortTh({ by, label: text, sort, desc, set, asc, dsc }: {
  by: SortBy; label: string; sort: SortBy; desc: boolean; set: (by: SortBy) => void; asc: string; dsc: string;
}) {
  const on = sort === by;
  return (
    <th scope="col" aria-sort={on ? (desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" class={`sortbtn${on ? ' on' : ''}`} onClick={() => set(by)}>
        {text} <span aria-hidden="true">{on ? (desc ? '↓' : '↑') : '↕'}</span>
        {on && <span class="vh">, {desc ? dsc : asc}</span>}
      </button>
    </th>
  );
}

function List({ open, tick }: { open: (id: string) => void; tick: number }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortBy>('date');
  const [desc, setDesc] = useState(false);
  void tick; // re-render when the shared filters change
  index();
  const set = (by: SortBy) => { if (by === sort) setDesc(!desc); else { setSort(by); setDesc(false); } };

  const words = fold(q).split(/\s+/).filter(Boolean);
  const bySource = (a: ChronicleEvent, b: ChronicleEvent) => {
    const x = SRC.get(a.id)!.label, y = SRC.get(b.id)!.label;
    if (!x !== !y) return x ? -1 : 1; // events without a source last, whichever the direction
    return (x.localeCompare(y, locale()) || key(a) - key(b)) * (desc ? -1 : 1);
  };
  const shown = EV.filter(e => state.cats.has(e.cat)
    && (!state.branch || e.kind === 'history' || P[e.person]?.branch === state.branch)
    && words.every(w => HAY.get(e.id)!.includes(w)))
    .sort(sort === 'source' ? bySource : (a, b) => (key(a) - key(b)) * (desc ? -1 : 1));

  return (
    <>
      <div class="tlhead">
        <h2 class="vh">{L.events}</h2>
        <div class="evtools">
          <input type="search" value={q} placeholder={L.filterPh} aria-label={L.filterAria}
            onInput={ev => setQ((ev.target as HTMLInputElement).value)} />
          <span class="hint meta" aria-live="polite">{L.count(shown.length, EV.length)}</span>
        </div>
      </div>
      <div class="evtable-wrap">
        <table class="evtable">
          <thead>
            <tr>
              <SortTh by="date" label={L.col.date} sort={sort} desc={desc} set={set} asc={L.oldest} dsc={L.newest} />
              <th scope="col"><span class="vh">{L.col.category}</span></th>
              <th scope="col">{L.col.event}</th>
              <th scope="col">{L.col.people}</th>
              <th scope="col">{L.col.place}</th>
              <SortTh by="source" label={L.col.source} sort={sort} desc={desc} set={set} asc={L.az} dsc={L.za} />
              <th scope="col"><span class="vh">{L.col.link}</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const ids = peopleOf(e);
              const src = SRC.get(e.id)!;
              const title = evTitle(e);
              const names = ids.slice(0, MAX_NAMES).map(id => P[id].name).join(', ')
                + (ids.length > MAX_NAMES ? ` +${ids.length - MAX_NAMES}` : '');
              return (
                <tr key={e.id} class={`c-${e.cat}`} tabIndex={0} onClick={() => open(e.id)}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(e.id); } }}>
                  <td class="d">{when(e)}</td>
                  <td class="k"><span class={`g ${e.cat}`} title={L.cat[e.cat]} /><span class="vh">{L.cat[e.cat]}</span></td>
                  <td class="t">{title}</td>
                  <td class="p">{names}</td>
                  <td class="pl">{e.place ? PL[e.place]?.label ?? e.place : ''}</td>
                  <td class="s" title={src.about}>{src.label}</td>
                  <td class="lk">{src.url && (
                    <a href={src.url} target="_blank" rel="noopener" onClick={ev => ev.stopPropagation()}
                      onKeyDown={ev => ev.stopPropagation()} aria-label={L.linkAria(src.label, title)}>{L.linkText}</a>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p class="empty" style="padding:12px 14px;margin:0">{L.noMatch}</p>}
      </div>
    </>
  );
}

export function createEventList(el: HTMLElement, on: { event(id: string): void }): EventListView {
  let tick = 0;
  const draw = () => render(<List open={on.event} tick={tick} />, el);
  draw();
  return { rebuild: () => { tick++; draw(); } };
}
