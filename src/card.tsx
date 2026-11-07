import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { EV, HISTORY_LABEL, NOW, P, PL, relatives } from './data';
import { visibleEvents } from './globe';
import { state } from './state';
import { bcls, CAT_LABEL, fmt, label } from './util';
import type { ChronicleEvent, HistoryEvent } from './types';

export interface CardView {
  showPerson(id: string): void;
  showEvent(id: string): void;
  showPlace(key: string): void;
}

type Open = (personId: string) => void;

const placeLabel = (k: string) => PL[k]?.label || k;

const Swatch = ({ branch }: { branch: string }) => <span class={`sw ${bcls(branch)}`} aria-hidden="true" />;

const ReadMore = ({ href }: { href: string }) => <a href={href} target="_blank" rel="noopener">Read more ↗</a>;

function Head({ eyebrow, title, meta }: { eyebrow: ComponentChildren; title: string; meta: ComponentChildren }) {
  return (
    <div>
      <div class="eyebrow">{eyebrow}</div>
      <h3>{title}</h3>
      <div class="meta">{meta}</div>
    </div>
  );
}

function EvRow({ e, open }: { e: ChronicleEvent; open?: Open }) {
  const yr = e.kind === 'history' ? (e.end && e.end > e.date.y ? `${e.date.y}–${String(e.end).slice(2)}` : e.date.y) : fmt(e.date);
  const pid = open && e.person;
  const link = e.kind === 'history' && e.link;
  return (
    <li>
      <span class="yr">{yr}</span>
      <span class={`g ${e.cat}`} title={CAT_LABEL[e.cat]} />
      <div>
        <div class="t" style={pid ? { cursor: 'pointer' } : undefined} onClick={pid ? () => open(pid) : undefined}>
          {e.title}{e.place && <span class="x"> · {placeLabel(e.place)}</span>}
        </div>
        {e.text && <div class="x">{e.text}</div>}
        {link && <div class="x"><ReadMore href={link} /></div>}
      </div>
    </li>
  );
}

/** a titled row of buttons, one per known relative; nothing when there are none */
function Relatives({ title, ids, open }: { title: string; ids: (string | undefined)[]; open: Open }) {
  const known = ids.filter((id): id is string => !!id && !!P[id]);
  if (!known.length) return null;
  return (
    <div>
      <div class="eyebrow">{title}</div>
      <div class="rel" style={{ marginTop: '5px' }}>
        {known.map(id => <button key={id} onClick={() => open(id)}>{label(P[id])}</button>)}
      </div>
    </div>
  );
}

function PersonCard({ id, open }: { id: string; open: Open }) {
  const p = P[id];
  const own = EV.filter(e => e.kind === 'family' && (e.person === id || e.partner === id));
  const hist = EV.filter(e => e.kind === 'history' && e.people.includes(id));
  const life = p.by ? EV.filter(e => e.kind === 'history' && e.cat === 'context' && (e.end || e.date.y) >= p.by!
    && e.date.y <= (p.dy || NOW) && !e.people.includes(id)).length : 0;
  const evs = [...own, ...hist].filter(e => state.cats.has(e.cat)).sort((a, b) => a.date.y - b.date.y);
  const f = relatives(p);
  return (
    <>
      <Head
        eyebrow={<><Swatch branch={p.branch} />{p.branch} branch</>}
        title={label(p)}
        meta={`${p.by ? (p.byEst ? 'c. ' : '') + p.by : '?'} – ${p.dy || (p.dead ? '?' : '')}${p.living ? ' · may be living' : ''}`}
      />
      {evs.length
        ? <ul class="evlist">{evs.map(e => <EvRow key={e.id} e={e} />)}</ul>
        : <p class="empty">No events with a date or place yet.</p>}
      {p.notes.length > 0 && (
        <div>
          <div class="eyebrow">Notes from the tree</div>
          <p class="x" style={{ margin: '4px 0 0' }}>{p.notes.flatMap((n, i) => i ? [<br />, n] : [n])}</p>
        </div>
      )}
      {life > 0 && (
        <p class="hint" style={{ margin: 0 }}>
          {life} context events fall within this lifetime. They show on the {HISTORY_LABEL} row of the timeline.
        </p>
      )}
      <Relatives title="Parents" ids={f.parents} open={open} />
      <Relatives title="Spouses" ids={f.spouses} open={open} />
      <Relatives title="Children" ids={f.kids} open={open} />
      <Relatives title="Siblings" ids={f.sibs} open={open} />
    </>
  );
}

function EventCard({ e, open }: { e: HistoryEvent; open: Open }) {
  return (
    <>
      <Head
        eyebrow={`${CAT_LABEL[e.cat]} · history`}
        title={e.title}
        meta={`${e.date.y}${e.end ? '–' + e.end : ''}${e.place ? ' · ' + placeLabel(e.place) : ''}`}
      />
      <p style={{ margin: 0 }}>{e.text}</p>
      {e.link && <ReadMore href={e.link} />}
      <Relatives title="Relatives this may concern" ids={e.people} open={open} />
    </>
  );
}

function PlaceCard({ k, open }: { k: string; open: Open }) {
  const evs = visibleEvents().filter(e => e.place === k).sort((a, b) => a.date.y - b.date.y);
  const pl = PL[k];
  return (
    <>
      <Head
        eyebrow={`Place · ${state.win[0]}–${state.win[1]}`}
        title={pl.label}
        meta={`${pl.lat.toFixed(2)}° N, ${pl.lon.toFixed(2)}° E${pl.approx ? ' · approximate location' : ''}`}
      />
      <ul class="evlist">{evs.map(e => <EvRow key={e.id} e={e} open={open} />)}</ul>
    </>
  );
}

export function createCard(
  card: HTMLElement,
  on: { personShown(id: string): void; changed(): void },
): CardView {
  /** a relative's button, or a person's row on a place card */
  const open: Open = id => { showPerson(id); on.personShown(id); };

  function showPerson(id: string) {
    state.sel = id;
    render(<PersonCard key={id} id={id} open={open} />, card);
    on.changed();
  }

  function showEvent(id: string) {
    const e = EV.find(x => x.id === id);
    if (!e) return;
    if (e.kind === 'family') { showPerson(e.person); return; }
    state.sel = null;
    render(<EventCard key={id} e={e} open={open} />, card);
    on.changed();
  }

  function showPlace(k: string) {
    render(<PlaceCard key={k} k={k} open={open} />, card);
  }

  return { showPerson, showEvent, showPlace };
}
