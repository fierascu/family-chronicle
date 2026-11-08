import { render } from 'preact';
import { useState } from 'preact/hooks';
import { EV, P, PL } from './data';
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

const when = (e: ChronicleEvent) =>
  e.kind === 'history' ? (e.end && e.end > e.date.y ? `${e.date.y}–${e.end}` : String(e.date.y)) : fmt(e.date);

/** sort key: year, month, day; an estimated or year-only date sorts at the start of its year */
const key = (e: ChronicleEvent) => e.date.y * 10000 + (e.date.m ?? 0) * 100 + (e.date.d ?? 0);

/** everything the search box matches against, folded once */
const HAY = new Map(EV.map(e => [e.id, fold([
  e.title, when(e), e.place ? PL[e.place]?.label ?? e.place : '', ...peopleOf(e).map(id => label(P[id])),
].join(' '))]));

const MAX_NAMES = 3;

function List({ open, tick }: { open: (id: string) => void; tick: number }) {
  const [q, setQ] = useState('');
  const [desc, setDesc] = useState(false);
  void tick; // re-render when the shared filters change

  const words = fold(q).split(/\s+/).filter(Boolean);
  const shown = EV.filter(e => state.cats.has(e.cat)
    && (!state.branch || e.kind === 'history' || P[e.person]?.branch === state.branch)
    && words.every(w => HAY.get(e.id)!.includes(w)))
    .sort((a, b) => (key(a) - key(b)) * (desc ? -1 : 1));

  return (
    <>
      <div class="tlhead">
        <h2>Events</h2>
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
              <th scope="col" aria-sort={desc ? 'descending' : 'ascending'}>
                <button type="button" class="sortbtn" onClick={() => setDesc(!desc)}>
                  Date <span aria-hidden="true">{desc ? '↓' : '↑'}</span>
                  <span class="vh">{desc ? ', newest first' : ', oldest first'}</span>
                </button>
              </th>
              <th scope="col"><span class="vh">Category</span></th>
              <th scope="col">Event</th>
              <th scope="col">People</th>
              <th scope="col">Place</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const ids = peopleOf(e);
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
