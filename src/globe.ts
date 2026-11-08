import * as d3 from 'd3';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon } from 'geojson';
// World maps ship with the app (no CDN); each is a separate file fetched only when that zoom level is reached
import land110Url from 'world-atlas/land-110m.json?url';
import land50Url from 'world-atlas/land-50m.json?url';
import countries10Url from 'world-atlas/countries-10m.json?url';
import { EV, GEO, HOME, NOW, P, PL, people, personPath } from './data';
import { L } from './i18n';
import { state } from './state';
import { bcls } from './util';
import type { ChronicleEvent, Category, CountryOutline } from './types';

export interface GlobeView {
  /** full redraw of pins, labels and migration lines (after filter, selection or time window changes) */
  drawPins(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** back to the starting view on Romania */
  reset(): void;
}

type LandTopo = Topology<{ land: GeometryCollection }>;
type CountriesTopo = Topology<{ countries: GeometryCollection }>;

const W = 480, H = 480;
const SCALE_MIN = 80, SCALE_MAX = 8000;
const START_SCALE = 2200; // Romania fills the view
const rank: Record<Category, number> = { sure: 3, plausible: 2, context: 1, fun: 0 };

interface PinRow { k: string; evs: ChronicleEvent[]; cat: Category }
interface Segment { a: string; b: string; pid: string }

export function visibleEvents(): ChronicleEvent[] {
  return EV.filter(e => state.cats.has(e.cat) && e.place
    && (!state.branch || e.kind === 'history' || P[e.person].branch === state.branch)
    && ((e.kind === 'history' && e.end) || e.date.y) >= state.win[0] && e.date.y <= state.win[1]);
}

const toGJ = (c: CountryOutline): Feature<MultiPolygon> =>
  ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: c.polys } });

/** Detail level 0 = globe view, 1 = regional (scale ≥ 400), 2 = local (scale ≥ 800) */
const zoomLevel = (scale: number) => (scale >= 800 ? 2 : scale >= 400 ? 1 : 0);

export function createGlobe(
  canvas: HTMLCanvasElement,
  svgEl: SVGSVGElement,
  spanEl: HTMLElement,
  on: { place(key: string): void },
): GlobeView {
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${W} ${H}`);
  // Orthographic projection centred and zoomed on Romania [25°E, 46°N]
  const proj = d3.geoOrthographic().scale(START_SCALE).translate([W / 2, H / 2]).clipAngle(90).rotate([-25, -46, 0]);
  // SVG path generator for pins/arcs only (lightweight: no large topologies)
  const path = d3.geoPath(proj);
  const xy = (k: string) => proj([PL[k].lon, PL[k].lat])!;

  /* ---- canvas: background geography, repainted every frame ---- */
  const ctx = canvas.getContext('2d')!;
  const canvasPath = d3.geoPath(proj, ctx);
  // The canvas is sized to its rendered pixels; ctx.scale maps viewBox units (0–W) to device pixels,
  // so proj() gives the same numbers for canvas and SVG.
  let canvasScale = 1; // CSS px per viewBox unit
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return; // not laid out yet
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.width * dpr; // square
    canvasScale = rect.width / W;
    paintCanvas();
    if (ready) drawPins(); // pin and label sizes are in screen pixels
  }
  new ResizeObserver(resizeCanvas).observe(canvas);
  requestAnimationFrame(resizeCanvas);

  // Canvas can't use var(): resolve the CSS colours, refresh on theme change
  let colours = { water: '', land: '', landHome: '', rule: '', muted: '' };
  function refreshColours() {
    const s = getComputedStyle(document.documentElement);
    const g = (n: string) => s.getPropertyValue(n).trim();
    colours = { water: g('--water'), land: g('--land'), landHome: g('--land-ro'), rule: g('--rule'), muted: g('--muted') };
    paintCanvas();
  }
  new MutationObserver(refreshColours).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshColours);

  const layers: {
    land: Feature | FeatureCollection | null;
    borders: MultiLineString | null;
    home: Feature<MultiPolygon> | null;
    neighbours: Feature<MultiPolygon>[];
  } = { land: null, borders: null, home: null, neighbours: [] };
  const homeOutline = GEO.find(c => c.name === HOME);
  layers.home = homeOutline ? toGJ(homeOutline) : null;
  layers.neighbours = GEO.filter(c => c.name !== HOME).map(toGJ);

  let detail = 0;
  let ready = false; // set once the SVG layers exist

  function paintCanvas() {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvasScale * dpr, canvasScale * dpr);
    const { water, land, landHome, rule, muted } = colours;

    ctx.beginPath(); canvasPath({ type: 'Sphere' });
    ctx.fillStyle = water; ctx.fill();

    if (layers.land) {
      ctx.beginPath(); canvasPath(layers.land);
      ctx.fillStyle = land; ctx.fill();
    }
    for (const f of layers.neighbours) {
      ctx.beginPath(); canvasPath(f);
      ctx.fillStyle = land; ctx.strokeStyle = rule; ctx.lineWidth = 0.4;
      ctx.fill(); ctx.stroke();
    }
    if (layers.home) {
      ctx.beginPath(); canvasPath(layers.home);
      ctx.fillStyle = landHome; ctx.strokeStyle = muted; ctx.lineWidth = 0.5;
      ctx.fill(); ctx.stroke();
    }

    const step = detail >= 1 ? 5 : 10;
    ctx.beginPath(); canvasPath(d3.geoGraticule().step([step, step])());
    ctx.strokeStyle = rule; ctx.lineWidth = 0.4; ctx.globalAlpha = 0.6; ctx.stroke();
    ctx.globalAlpha = 1;

    if (detail >= 2 && layers.borders) {
      ctx.beginPath(); canvasPath(layers.borders);
      ctx.strokeStyle = muted; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // Fetch each map file once; later calls reuse the same promise
  const tiles = new Map<string, Promise<unknown>>();
  const loadTile = <T>(url: string) => {
    if (!tiles.has(url)) tiles.set(url, d3.json(url));
    return tiles.get(url) as Promise<T>;
  };
  const showLand = (url: string, level: number) => loadTile<LandTopo>(url).then(world => {
    if ((detail >= 1 ? 1 : 0) !== level) return; // zoom changed while loading
    layers.land = feature(world, world.objects.land);
    paintCanvas();
  });

  function applyDetailLevel(level: number) {
    if (level === detail) return;
    detail = level;
    showLand(level >= 1 ? land50Url : land110Url, level >= 1 ? 1 : 0);
    if (level >= 2 && !layers.borders) {
      loadTile<CountriesTopo>(countries10Url).then(world => {
        layers.borders = mesh(world, world.objects.countries, (a, b) => a !== b);
        paintCanvas();
      });
    }
  }
  refreshColours();
  showLand(land110Url, 0);
  applyDetailLevel(zoomLevel(START_SCALE));

  /* ---- SVG overlay: migration lines, pins, labels ---- */
  const migG = svg.append('g'), pinG = svg.append('g'), lblG = svg.append('g');
  const onFront = (lon: number, lat: number) => d3.geoDistance([lon, lat], proj.invert!([W / 2, H / 2])!) < Math.PI / 2;
  /** viewBox units for n CSS pixels, so pins and labels keep the same on-screen size at any width */
  const px = (n: number) => n / (canvasScale || 1);
  const pinR = (events: number) => px(4.5 + Math.sqrt(events) * 1.25);
  const radius = (d: Pin) => pinR(d.evs.length);
  const segPath = (d: Segment) => {
    const a = PL[d.a], b = PL[d.b];
    return a && b ? path({ type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }) ?? '' : '';
  };
  /** same shapes as the legend: circle, diamond, square, star; a cluster is a circle with a count */
  const SHAPE: Record<Category, d3.SymbolType> = {
    sure: d3.symbolCircle, plausible: d3.symbolDiamond, context: d3.symbolSquare, fun: d3.symbolStar,
  };
  const symbol = (d: Pin) => {
    const many = d.keys.length > 1;
    const grow = many ? 1.3 : d.cat === 'fun' ? 1.6 : d.cat === 'plausible' ? 1.25 : 1;
    return d3.symbol(many ? d3.symbolCircle : SHAPE[d.cat], Math.PI * radius(d) ** 2 * grow)()!;
  };

  /** a pin: one place, or a cluster of places that would overlap at this zoom */
  interface Pin { k: string; keys: string[]; evs: ChronicleEvent[]; cat: Category; lon: number; lat: number }

  /** merges overlapping pins, repeating until none overlap (a merged pin is larger and may touch another);
   * a cluster sits at the busiest place in it */
  function cluster(rows: PinRow[]): Pin[] {
    let out: (Pin & { x: number; y: number })[] = [...rows].sort((a, b) => b.evs.length - a.evs.length).map(r => {
      const [x, y] = xy(r.k);
      return { k: r.k, keys: [r.k], evs: r.evs, cat: r.cat, lon: PL[r.k].lon, lat: PL[r.k].lat, x, y };
    });
    for (let merged = true; merged;) {
      merged = false;
      const next: typeof out = [];
      for (const p of out) {
        const hit = next.find(c => Math.hypot(c.x - p.x, c.y - p.y) < (radius(p) + radius(c)) * 1.15);
        if (!hit) { next.push(p); continue; }
        hit.keys.push(...p.keys); hit.evs = hit.evs.concat(p.evs);
        if (rank[p.cat] > rank[hit.cat]) hit.cat = p.cat;
        merged = true;
      }
      out = next;
    }
    return out;
  }

  let labelKeys = new Set<string>(); // labels that passed the last collision filter
  let leftSide = new Set<string>(); // labels placed left of their pin
  const labelX = (d: Pin) => pinXY(d)[0] + (leftSide.has(d.k) ? -1 : 1) * (radius(d) + px(4));

  function drawMig() {
    const segs: Segment[] = [];
    for (const p of people) {
      if (state.branch && p.branch !== state.branch) continue;
      const s = personPath(p);
      for (let i = 1; i < s.length; i++) segs.push({ a: s[i - 1], b: s[i], pid: p.id });
    }
    migG.selectAll<SVGPathElement, Segment>('path').data(segs).join('path')
      .attr('class', d => `mig ${bcls(P[d.pid].branch)}` + (d.pid === state.sel ? ' on' : ''))
      .attr('d', segPath).style('stroke-width', d => px(d.pid === state.sel ? 2.6 : 1.3));
  }

  const pinXY = (d: Pin) => proj([d.lon, d.lat])!;
  const placeName = (k: string) => PL[k].label.split(/[,(]/)[0].trim();

  function drawPins() {
    spanEl.textContent = `${state.win[0]}–${Math.min(state.win[1], NOW)}`;
    const byPlace = d3.group(visibleEvents(), e => e.place!);
    const selPlaces = state.sel ? new Set(personPath(P[state.sel])) : new Set<string>();
    const rows: PinRow[] = [...byPlace].filter(([k]) => onFront(PL[k].lon, PL[k].lat)).map(([k, evs]) =>
      ({ k, evs, cat: evs.reduce<Category>((a, e) => (rank[e.cat] > rank[a] ? e.cat : a), 'fun') }));
    const pins = cluster(rows);
    const many = (d: Pin) => d.keys.length > 1;
    const isSel = (d: Pin) => d.keys.some(k => selPlaces.has(k));
    const desc = (d: Pin) => many(d)
      ? L.pinMany(d.keys.length, d.keys.map(placeName).join(', '), d.evs.length)
      : L.pinOne(PL[d.k].label, d.evs.length);

    const g = pinG.selectAll<SVGGElement, Pin>('g').data(pins, d => d.keys.join('|')).join(enter => {
      const e = enter.append('g');
      e.append('path'); e.append('text').attr('class', 'pc'); e.append('title');
      return e;
    });
    g.attr('class', d => `pin ${many(d) ? 'cluster' : d.cat}${isSel(d) ? ' on' : ''}`)
      .attr('transform', d => `translate(${pinXY(d)})`).attr('display', null)
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', desc)
      .on('click', (_ev, d) => open(d))
      .on('keydown', (ev: KeyboardEvent, d) => { if (ev.key === 'Enter') open(d); });
    g.select('path').attr('d', symbol).style('stroke-width', d => px(isSel(d) ? 2.5 : 1.5));
    g.select<SVGTextElement>('text.pc').text(d => (many(d) ? d.keys.length : ''))
      .style('font-size', `${px(10.5)}px`).attr('dy', '0.35em');
    g.select('title').text(desc);

    // Label candidates: at L0 only busy or selected places; at L1+ all places, most important first
    const weight = (d: Pin) => (isSel(d) ? 1000 : 0) + d.evs.length;
    const candidates = (detail >= 1 ? pins : pins.filter(d => d.evs.length >= 3 || isSel(d)))
      .sort((a, b) => weight(b) - weight(a));
    // Greedy collision filter: a label (an estimated box beside its pin, right side first, then left)
    // is skipped when both sides would cover another pin or a label already placed
    const text = (d: Pin) => placeName(d.k) + (many(d) ? ` +${d.keys.length - 1}` : '');
    type Box = [number, number, number, number];
    const boxOf = (d: Pin, left: boolean): Box => {
      const [cx, cy] = pinXY(d), w = px(6.4) * text(d).length, gap = radius(d) + px(4);
      return left ? [cx - gap - w, cy - px(8), cx - gap, cy + px(8)] : [cx + gap, cy - px(8), cx + gap + w, cy + px(8)];
    };
    const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const free = (d: Pin, b: Box) => b[0] > 0 && b[2] < W && !placed.some(q => overlaps(b, q)) && !pins.some(o => {
      if (o === d) return false;
      const [ox, oy] = pinXY(o), r = radius(o);
      return overlaps(b, [ox - r, oy - r, ox + r, oy + r]);
    });
    const placed: Box[] = [];
    leftSide = new Set();
    const shown = candidates.filter(d => {
      for (const left of [false, true]) {
        const b = boxOf(d, left);
        if (!free(d, b)) continue;
        placed.push(b);
        if (left) leftSide.add(d.k);
        return true;
      }
      return false;
    });
    labelKeys = new Set(shown.map(d => d.k));
    lblG.selectAll<SVGTextElement, Pin>('text').data(shown, d => d.k).join('text').attr('class', 'pl')
      .style('font-size', `${px(12)}px`).style('stroke-width', `${px(3)}px`).attr('dy', '0.35em')
      .attr('text-anchor', d => (leftSide.has(d.k) ? 'end' : 'start'))
      .attr('x', labelX).attr('y', d => pinXY(d)[1]).attr('display', null)
      .text(text);
    drawMig();
  }

  /** reposition pins, labels and lines after the projection moved */
  function redrawPins() {
    pinG.selectAll<SVGGElement, Pin>('g')
      .attr('transform', d => `translate(${pinXY(d)})`)
      .attr('display', d => (onFront(d.lon, d.lat) ? null : 'none'));
    lblG.selectAll<SVGTextElement, Pin>('text')
      .attr('x', labelX).attr('y', d => pinXY(d)[1])
      .attr('display', d => (labelKeys.has(d.k) && onFront(d.lon, d.lat) ? null : 'none'));
    migG.selectAll<SVGPathElement, Segment>('path').attr('d', segPath);
  }

  /* ---- view changes: zoom, rotate, reset ---- */
  function setScale(scale: number) {
    proj.scale(Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale)));
    applyDetailLevel(zoomLevel(proj.scale()));
    paintCanvas();
    drawPins(); // full rebind: clusters and the label threshold depend on the zoom
  }
  /** a place opens its card; a cluster zooms in on its places */
  function open(d: Pin) {
    if (d.keys.length === 1 || proj.scale() >= SCALE_MAX) { on.place(d.k); return; }
    const lon = d3.mean(d.keys, k => PL[k].lon)!, lat = d3.mean(d.keys, k => PL[k].lat)!;
    proj.rotate([-lon, -lat, 0]);
    setScale(proj.scale() * 2.5);
  }
  function reset() { proj.rotate([-25, -46, 0]); setScale(START_SCALE); }

  /* ---- gestures: a mouse drag turns the globe any way. On touch, one finger turns it sideways
     (vertical swipes scroll the page: touch-action pan-y) and two fingers pinch to zoom and move it ---- */
  const ptrs = new Map<number, { x: number; y: number }>();
  let gesture: { rotate: [number, number, number]; scale: number; x: number; y: number; dist: number } | null = null;
  let dragged = false, downAt = { x: 0, y: 0 };
  const centre = () => {
    const p = [...ptrs.values()];
    return {
      x: d3.mean(p, q => q.x)!, y: d3.mean(p, q => q.y)!,
      dist: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
    };
  };
  const begin = () => { gesture = { rotate: proj.rotate(), scale: proj.scale(), ...centre() }; };
  svgEl.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 1) { dragged = false; downAt = { x: ev.clientX, y: ev.clientY }; }
    begin();
  });
  svgEl.addEventListener('pointermove', ev => {
    if (!ptrs.has(ev.pointerId) || !gesture) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!dragged && (ptrs.size > 1 || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4)) {
      dragged = true;
      for (const id of ptrs.keys()) svgEl.setPointerCapture(id);
    }
    if (!dragged) return;
    const m = centre();
    if (ptrs.size > 1 && gesture.dist) {
      proj.scale(Math.max(SCALE_MIN, Math.min(SCALE_MAX, gesture.scale * m.dist / gesture.dist)));
      applyDetailLevel(zoomLevel(proj.scale()));
    }
    const k = 90 / proj.scale() / (canvasScale || 1);
    const [r0, r1, r2] = gesture.rotate;
    const dy = ev.pointerType === 'touch' && ptrs.size === 1 ? 0 : m.y - gesture.y;
    proj.rotate([r0 + (m.x - gesture.x) * k, Math.max(-89, Math.min(89, r1 - dy * k)), r2]);
    paintCanvas();
    redrawPins();
  });
  const end = (ev: PointerEvent) => {
    if (!ptrs.delete(ev.pointerId)) return;
    if (ptrs.size) begin(); else { gesture = null; if (dragged) drawPins(); }
  };
  svgEl.addEventListener('pointerup', end);
  svgEl.addEventListener('pointercancel', end);
  // a drag that ends on a pin is not a click
  svgEl.addEventListener('click', ev => { if (dragged) { ev.stopPropagation(); dragged = false; } }, true);

  svgEl.addEventListener('wheel', ev => {
    ev.preventDefault();
    setScale(proj.scale() * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  ready = true;
  return { drawPins, zoomIn: () => setScale(proj.scale() * 1.6), zoomOut: () => setScale(proj.scale() / 1.6), reset };
}
