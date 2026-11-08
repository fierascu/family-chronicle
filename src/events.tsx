import { render } from 'preact';
import { useState } from 'preact/hooks';
import { EV, P, PL } from './data';
import { sourceOf } from './sources';
import { state } from './state';
import { CAT_LABEL, fmt, label } from './util';
import type { ChronicleEvent } from './types';

export interface EventListView {
  /** re-apply the category and branch filters */
  rebuild(): void;
}

/** lower case, without diacritics, so "fierascu" finds "Fierăscu" */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const peopleOf = (e: ChronicleEvent) =>
  (e.kind === 'family' ? [e.person, e.partner] : e.people).filter((id): id is string => !!id && !!P[id]);

export const when = (e: ChronicleEvent) =>
  e.kind === 'history' ? (e.end && e.end > e.date.y ? `${e.date.y}–${e.end}` : String(e.date.y)) : fmt(e.date);

/** sort key: year, month, day; an estimated or year-only date sorts at the start of its year */
const key = (e: ChronicleEvent) => e.date.y * 10000 + (e.date.m ?? 0) * 100 + (e.date.d ?? 0);

const SRC = new Map(EV.map(e => [e.id, sourceOf(e)]));

/** everything the search box matches against, folded once */
const HAY = new Map(EV.map(e => [e.id, fold([
  e.title, when(e), e.place ? PL[e.place]?.label ?? e.place : '', ...peopleOf(e).map(id => label(P[id])),
  SRC.get(e.id)!.label,
].join(' '))]));

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
  const set = (by: SortBy) => { if (by === sort) setDesc(!desc); else { setSort(by); setDesc(false); } };

  const words = fold(q).split(/\s+/).filter(Boolean);
  const bySource = (a: ChronicleEvent, b: ChronicleEvent) => {
    const x = SRC.get(a.id)!.label, y = SRC.get(b.id)!.label;
    if (!x !== !y) return x ? -1 : 1; // events without a source last, whichever the direction
    return (x.localeCompare(y) || key(a) - key(b)) * (desc ? -1 : 1);
  };
  const shown = EV.filter(e => state.cats.has(e.cat)
    && (!state.branch || e.kind === 'history' || P[e.person]?.branch === state.branch)
    && words.every(w => HAY.get(e.id)!.includes(w)))
    .sort(sort === 'source' ? bySource : (a, b) => (key(a) - key(b)) * (desc ? -1 : 1));

  return (
    <>
      <div class="tlhead">
        <h2 class="vh">Events</h2>
        <div class="evtools">
          <input type="search" value={q} placeholder="Filter by name, place, year…" aria-label="Filter events"
            onInput={ev => setQ((ev.target as HTMLInputElement).value)} />
          <span class="hint meta" aria-live="polite">{shown.length} of {EV.length}</span>
        </div>
      </div>
      <div class="evtable-wrap">
        <table class="evtable">
          <thead>
            <tr>
              <SortTh by="date" label="Date" sort={sort} desc={desc} set={set} asc="oldest first" dsc="newest first" />
              <th scope="col"><span class="vh">Category</span></th>
              <th scope="col">Event</th>
              <th scope="col">People</th>
              <th scope="col">Place</th>
              <SortTh by="source" label="Source" sort={sort} desc={desc} set={set} asc="A to Z" dsc="Z to A" />
              <th scope="col"><span class="vh">Link</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const ids = peopleOf(e);
              const src = SRC.get(e.id)!;
              const names = ids.slice(0, MAX_NAMES).map(id => P[id].name).join(', ')
                + (ids.length > MAX_NAMES ? ` +${ids.length - MAX_NAMES}` : '');
              return (
                <tr key={e.id} class={`c-${e.cat}`} tabIndex={0} onClick={() => open(e.id)}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(e.id); } }}>
                  <td class="d">{when(e)}</td>
                  <td class="k"><span class={`g ${e.cat}`} title={CAT_LABEL[e.cat]} /><span class="vh">{CAT_LABEL[e.cat]}</span></td>
                  <td class="t">{e.title}</td>
                  <td class="p">{names}</td>
                  <td class="pl">{e.place ? PL[e.place]?.label ?? e.place : ''}</td>
                  <td class="s" title={src.about}>{src.label}</td>
                  <td class="lk">{src.url && (
                    <a href={src.url} target="_blank" rel="noopener" onClick={ev => ev.stopPropagation()}
                      onKeyDown={ev => ev.stopPropagation()} aria-label={`${src.label}: ${e.title} (opens in a new tab)`}>link ↗</a>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p class="empty" style="padding:12px 14px;margin:0">No events match.</p>}
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
