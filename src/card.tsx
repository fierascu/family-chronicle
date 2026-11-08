import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { EV, HISTORY_LABEL, NOW, P, PL, relatives, SURNAMES } from './data';
import { clipSrc, openClip } from './clips';
import { visibleEvents } from './globe';
import { state } from './state';
import { bcls, CAT_LABEL, fmt, label } from './util';
import type { ChronicleEvent, HistoryEvent, SurnameInfo } from './types';

export interface CardView {
  showPerson(id: string): void;
  showEvent(id: string): void;
  showPlace(key: string): void;
  showSurname(name: string): void;
}

type Open = (personId: string) => void;
type OpenName = (name: string) => void;

/** the family-name entries a person belongs to (birth name first, then married name) */
const surnamesOf = (id: string) => SURNAMES.filter(s => s.people.includes(id))
  .sort((a, b) => Number(b.spellings.some(x => x.spelling === P[id].surname)) - Number(a.spellings.some(x => x.spelling === P[id].surname)));

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
  return (
    <li>
      <span class="yr">{yr}</span>
      <span class={`g ${e.cat}`} title={CAT_LABEL[e.cat]} />
      <div>
        <div class="t" style={pid ? { cursor: 'pointer' } : undefined} onClick={pid ? () => open(pid) : undefined}>
          {e.title}{e.place && <span class="x"> · {placeLabel(e.place)}</span>}
        </div>
        {e.text && <div class="x">{e.text}</div>}
        {e.link && <div class="x"><ReadMore href={e.link} /></div>}
        {e.images?.length ? (
          <div class="clips">
            {e.images.map(f => (
              <button type="button" key={f} class="clip" aria-label={`Open newspaper page ${f}`} onClick={() => openClip(e, f)}>
                <img loading="lazy" src={clipSrc(f)} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** a titled row of buttons, one per known relative; nothing when there are none */
function Relatives({ title, ids, open }: { title: string; ids: (string | undefined)[]; open: Open }) {
  const known = ids.filter((id): id is string => !!id && !!P[id]);
  if (!known.length) return null;
  return (
    <div class="rel">
      <span class="eyebrow">{title}</span>
      {known.map(id => <button key={id} onClick={() => open(id)}>{label(P[id])}</button>)}
    </div>
  );
}

function PersonCard({ id, open, openName }: { id: string; open: Open; openName: OpenName }) {
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
      {surnamesOf(id).length > 0 && (
        <div>
          <div class="eyebrow">About the family name</div>
          <div class="rel" style={{ marginTop: '5px' }}>
            {surnamesOf(id).map(s => <button key={s.name} onClick={() => openName(s.name)}>{s.name}{s.meaning ? ` · ${s.meaning}` : ''}</button>)}
          </div>
        </div>
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
        eyebrow={`${CAT_LABEL[e.cat]} · ${e.cat === 'fun' ? 'family story' : 'history'}`}
        title={e.title}
        meta={`${e.date.y}${e.end ? '–' + e.end : ''}${e.place ? ' · ' + placeLabel(e.place) : ''}`}
      />
      <p style={{ margin: 0 }}>{e.text}</p>
      {e.link && <ReadMore href={e.link} />}
      <Relatives title={e.cat === 'fun' ? 'Relatives in this story' : 'Relatives this may concern'} ids={e.people} open={open} />
    </>
  );
}

function SurnameCard({ s, open }: { s: SurnameInfo; open: Open }) {
  const years = s.people.map(id => P[id].by).filter((y): y is number => !!y);
  const variants = [...new Set([...(s.variants ?? []), ...s.spellings.map(x => x.spelling)])].filter(v => v !== s.name);
  const described = s.meaning || s.origin || s.changes?.length;
  return (
    <>
      <Head
        eyebrow="Family name"
        title={s.name}
        meta={`${s.people.length} ${s.people.length === 1 ? 'person' : 'people'} in the tree${years.length ? ` · born ${Math.min(...years)}–${Math.max(...years)}` : ''}`}
      />
      {s.meaning && (
        <div>
          <div class="eyebrow">What the name suggests</div>
          <p style={{ margin: '4px 0 0' }}>{s.meaning}</p>
        </div>
      )}
      {s.origin && (
        <div>
          <div class="eyebrow">Origins</div>
          <p style={{ margin: '4px 0 0' }}>{s.origin}</p>
        </div>
      )}
      {variants.length > 0 && (
        <div>
          <div class="eyebrow">Variations</div>
          <p style={{ margin: '4px 0 0' }}>{variants.join(' · ')}</p>
        </div>
      )}
      <div>
        <div class="eyebrow">Changes over time</div>
        <ul class="evlist" style={{ marginTop: '6px' }}>
          {(s.changes ?? []).map((c, i) => (
            <li key={'c' + i}><span class="yr">{c.when}</span><span /><div class="x">{c.text}{c.link && <> <ReadMore href={c.link} /></>}</div></li>
          ))}
          {s.spellings.map(x => (
            <li key={x.spelling}>
              <span class="yr">{x.from ? `from ${x.from}` : '?'}</span><span />
              <div class="x">Spelled <b>{x.spelling}</b> in this tree ({s.people.filter(id => P[id].surname === x.spelling || P[id].married === x.spelling).length})</div>
            </li>
          ))}
        </ul>
      </div>
      {!described && (
        <p class="hint" style={{ margin: 0 }}>Nothing written about this name yet. Add it under <code>surnames</code> in the config file.</p>
      )}
      {s.link && <ReadMore href={s.link} />}
      <Relatives title="People with this name" ids={s.people} open={open} />
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
    render(<PersonCard key={id} id={id} open={open} openName={showSurname} />, card);
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

  function showSurname(name: string) {
    const s = SURNAMES.find(x => x.name === name);
    if (!s) return;
    render(<SurnameCard key={'n' + name} s={s} open={open} />, card);
  }

  return { showPerson, showEvent, showPlace, showSurname };
}
