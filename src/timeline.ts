import { DataSet, Timeline } from 'vis-timeline/standalone';
import type { DataGroup, DataItem } from 'vis-timeline/standalone';
import { BRANCHES, EV, HISTORY_LABEL, NOW, P, SET, people } from './data';
import { state } from './state';
import { bcls, esc, fmt, label, swatch, toDate } from './util';

export interface TimelineView {
  rebuild(): void;
  select(personId: string): void;
  focusPerson(personId: string): void;
}

const yrs = people.map(p => p.by).filter((y): y is number => !!y);
/** first year shown: config timelineStart, else the decade before the earliest birth */
export const T0 = SET.timelineStart || Math.floor((Math.min(...yrs, NOW) - 5) / 10) * 10;
export const FIRST_BIRTH = Math.min(...yrs);

export function createTimeline(
  el: HTMLElement,
  on: { person(id: string): void; event(id: string): void; range(): void },
): TimelineView {
  const groups = new DataSet<DataGroup>([
    { id: 'History', content: esc(HISTORY_LABEL), order: 0 } as DataGroup,
    ...BRANCHES.map((b, i) => {
      const span = document.createElement('span');
      span.innerHTML = swatch(b) + esc(b);
      return { id: b, content: span, order: i + 1 } as DataGroup;
    }),
  ]);
  const items = new DataSet<DataItem>();

  function rebuild() {
    const out: DataItem[] = [];
    for (const p of people) {
      if (!p.by) continue;
      if (state.branch && p.branch !== state.branch) continue;
      const end = p.dy || (p.dead ? Math.min(p.by + 70, NOW) : NOW);
      const est = p.byEst || (p.dead && !p.dy);
      out.push({
        id: 'p' + p.id, group: p.branch, type: 'range', start: new Date(p.by, 0, 1), end: new Date(end, 11, 31),
        content: esc(p.name + (p.living || p.dy ? '' : p.dead ? ' †' : '')),
        className: `life ${bcls(p.branch)}` + (est ? ' est' : ''),
        title: esc(`${label(p)} · ${p.byEst ? 'c. ' : ''}${p.by}–${p.dy || (p.dead ? '?' : '')}`),
      });
    }
    for (const e of EV) {
      if (!state.cats.has(e.cat)) continue;
      if (e.kind === 'family') {
        if (e.type === 'birt' || e.type === 'deat') continue; // shown by lifespan bars; still on map + card
        const p = P[e.person];
        if (state.branch && p.branch !== state.branch) continue;
        out.push({ id: e.id, group: p.branch, type: 'point', start: toDate(e.date), content: '', className: e.cat,
          title: esc(`${fmt(e.date)} · ${e.title}`) });
      } else {
        const r = !!e.end && e.end > e.date.y;
        out.push({
          id: e.id, group: 'History', type: r ? 'range' : 'point', start: new Date(e.date.y, 0, 1),
          end: r ? new Date(e.end!, 11, 31) : undefined, content: esc(e.title), className: e.cat + (r ? ' histr' : ''),
          title: esc(`${e.date.y}${r ? '–' + e.end : ''} · ${e.title}`),
        });
      }
    }
    items.clear();
    items.add(out);
    groups.forEach(g => groups.update({ id: g.id, visible: !state.branch || g.id === state.branch || g.id === 'History' }));
  }
  rebuild();

  state.win[0] = T0;
  const tl = new Timeline(el, items, groups, {
    start: new Date(T0, 0, 1), end: new Date(NOW, 11, 31), min: new Date(T0 - 30, 0, 1), max: new Date(NOW + 5, 0, 1),
    zoomMin: 1000 * 60 * 60 * 24 * 365 * 3, stack: true, maxHeight: 560, groupOrder: 'order', orientation: { axis: 'top' },
    margin: { item: { horizontal: 2, vertical: 4 } }, tooltip: { followMouse: true }, showCurrentTime: false, selectable: true,
  });
  tl.on('rangechanged', ({ start, end }: { start: Date; end: Date }) => {
    state.win = [start.getFullYear(), end.getFullYear()];
    on.range();
  });
  tl.on('select', ({ items: s }: { items: string[] }) => {
    if (!s.length) return;
    const id = s[0];
    if (id[0] === 'p') on.person(id.slice(1)); else on.event(id);
  });

  return {
    rebuild,
    select: id => tl.setSelection(['p' + id]),
    focusPerson: id => { if (items.get('p' + id)) tl.focus('p' + id, { animation: false }); },
  };
}
