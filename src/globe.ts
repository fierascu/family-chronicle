import * as d3 from 'd3';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon } from 'geojson';
// World maps ship with the app (no CDN); each is a separate file fetched only when that zoom level is reached
import land110Url from 'world-atlas/land-110m.json?url';
import land50Url from 'world-atlas/land-50m.json?url';
import countries10Url from 'world-atlas/countries-10m.json?url';
import { EV, GEO, HOME, P, PL, people, personPath } from './data';
import { state } from './state';
import { bcls } from './util';
import type { ChronicleEvent, Category, CountryOutline } from './types';

export interface GlobeView {
  /** full redraw of pins, labels and migration lines (after filter, selection or time window changes) */
  drawPins(): void;
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
  const onFront = (k: string) => d3.geoDistance([PL[k].lon, PL[k].lat], proj.invert!([W / 2, H / 2])!) < Math.PI / 2;
  const radius = (d: PinRow) => 4 + Math.sqrt(d.evs.length) * 2.4;
  const segPath = (d: Segment) => {
    const a = PL[d.a], b = PL[d.b];
    return a && b ? path({ type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }) ?? '' : '';
  };
  let labelKeys = new Set<string>(); // labels that passed the last collision filter

  function drawMig() {
    const segs: Segment[] = [];
    for (const p of people) {
      if (state.branch && p.branch !== state.branch) continue;
      const s = personPath(p);
      for (let i = 1; i < s.length; i++) segs.push({ a: s[i - 1], b: s[i], pid: p.id });
    }
    migG.selectAll<SVGPathElement, Segment>('path').data(segs).join('path')
      .attr('class', d => `mig ${bcls(P[d.pid].branch)}` + (d.pid === state.sel ? ' on' : ''))
      .attr('d', segPath);
  }

  function drawPins() {
    spanEl.textContent = `${state.win[0]}–${state.win[1]}`;
    const byPlace = d3.group(visibleEvents(), e => e.place!);
    const selPlaces = state.sel ? new Set(personPath(P[state.sel])) : new Set<string>();
    const rows: PinRow[] = [...byPlace].map(([k, evs]) =>
      ({ k, evs, cat: evs.reduce<Category>((a, e) => (rank[e.cat] > rank[a] ? e.cat : a), 'fun') }));
    pinG.selectAll<SVGCircleElement, PinRow>('circle').data(rows, d => d.k).join('circle')
      .attr('class', d => `pin ${d.cat}${selPlaces.has(d.k) ? ' on' : ''}`)
      .attr('cx', d => xy(d.k)[0]).attr('cy', d => xy(d.k)[1]).attr('r', radius)
      .attr('display', d => (onFront(d.k) ? null : 'none'))
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${PL[d.k].label}, ${d.evs.length} events`)
      .on('click', (_ev, d) => { on.place(d.k); })
      .on('keydown', (ev: KeyboardEvent, d) => { if (ev.key === 'Enter') { on.place(d.k); } })
      .selectAll('title').data(d => [d]).join('title')
      .text(d => `${PL[d.k].label} — ${d.evs.length} event${d.evs.length > 1 ? 's' : ''}`);

    // Label candidates: at L0 only busy or selected places; at L1+ all places, most important first
    const weight = (d: PinRow) => (selPlaces.has(d.k) ? 1000 : 0) + d.evs.length;
    const candidates = (detail >= 1 ? rows : rows.filter(d => d.evs.length >= 3 || selPlaces.has(d.k)))
      .filter(d => onFront(d.k)).sort((a, b) => weight(b) - weight(a));
    // Greedy collision filter: skip labels whose anchor is within MIN_GAP px of one already placed
    const MIN_GAP = 55;
    const placed: [number, number][] = [];
    const shown = candidates.filter(d => {
      const [cx, cy] = xy(d.k);
      const lx = cx + radius(d) + 3, ly = cy + 3.5;
      const hit = placed.some(([px, py]) => Math.hypot(lx - px, ly - py) < MIN_GAP);
      if (!hit) placed.push([lx, ly]);
      return !hit;
    });
    labelKeys = new Set(shown.map(d => d.k));
    lblG.selectAll<SVGTextElement, PinRow>('text').data(shown, d => d.k).join('text').attr('class', 'pl')
      .attr('x', d => xy(d.k)[0] + radius(d) + 3).attr('y', d => xy(d.k)[1] + 3.5).attr('display', null)
      .text(d => PL[d.k].label.split(/[,(]/)[0].trim());
    drawMig();
  }

  /** reposition pins, labels and lines after the projection moved */
  function redrawPins() {
    pinG.selectAll<SVGCircleElement, PinRow>('circle')
      .attr('cx', d => xy(d.k)[0]).attr('cy', d => xy(d.k)[1])
      .attr('display', d => (onFront(d.k) ? null : 'none'));
    lblG.selectAll<SVGTextElement, PinRow>('text')
      .attr('x', d => xy(d.k)[0] + radius(d) + 3).attr('y', d => xy(d.k)[1] + 3.5)
      .attr('display', d => (labelKeys.has(d.k) && onFront(d.k) ? null : 'none'));
    migG.selectAll<SVGPathElement, Segment>('path').attr('d', segPath);
  }

  /* ---- drag, zoom (no auto-rotation) ---- */
  let dragStart: { rotate: [number, number, number]; x: number; y: number } | null = null;
  svg.call(d3.drag<SVGSVGElement, unknown>()
    .on('start', ev => { dragStart = { rotate: proj.rotate(), x: ev.x, y: ev.y }; })
    .on('drag', ev => {
      if (!dragStart) return;
      const k = 90 / proj.scale();
      const [r0, r1, r2] = dragStart.rotate;
      proj.rotate([r0 + (ev.x - dragStart.x) * k, r1 - (ev.y - dragStart.y) * k, r2]);
      paintCanvas();
      redrawPins();
    })
    .on('end', () => { dragStart = null; }));

  svgEl.addEventListener('wheel', ev => {
    ev.preventDefault();
    const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, proj.scale() * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    proj.scale(scale);
    applyDetailLevel(zoomLevel(scale));
    paintCanvas();
    drawPins(); // full rebind so the label threshold updates
  }, { passive: false });

  return { drawPins };
}
