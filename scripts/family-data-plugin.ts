/**
 * Vite plugin: serves `virtual:family-data` = build/data.json (written by parse_gedcom.py)
 * plus `geo`, the outlines of the home country and its neighbours cut from Natural Earth (world-atlas).
 * Replaces the old extract_map.js + build.py steps.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { MultiPolygon, Polygon, Position } from 'geojson';

/** Countries drawn with borders on the globe: ISO 3166-1 numeric id → name. To map another country, change this list
 *  and set `settings.homeCountry` in the config. */
export const COUNTRIES: Record<string, string> = {
  '642': 'Romania', '348': 'Hungary', '688': 'Serbia', '100': 'Bulgaria', '804': 'Ukraine', '498': 'Moldova',
};
/** Only polygons with a point inside this box [west, south, east, north] are kept (drops far-off islands). */
export const REGION: [number, number, number, number] = [18, 42, 32, 50];

const VIRTUAL_ID = 'virtual:family-data';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

function extractGeo() {
  const require = createRequire(import.meta.url);
  const topo = require('world-atlas/countries-50m.json') as Topology<{ countries: GeometryCollection }>;
  const fc = feature(topo, topo.objects.countries);
  const r = (n: number) => Math.round(n * 100) / 100;
  const [w, s, e, n] = REGION;
  const clip = (ring: Position[]) =>
    ring.map(([x, y]) => [r(x), r(y)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  return fc.features
    .filter(f => f.id !== undefined && COUNTRIES[String(f.id)])
    .map(f => {
      const g = f.geometry as Polygon | MultiPolygon;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      return {
        name: COUNTRIES[String(f.id)],
        polys: polys.filter(p => p[0].some(([x, y]) => x > w && x < e && y > s && y < n)).map(p => p.map(clip)),
      };
    });
}

export default function familyData(): Plugin {
  const dataPath = resolve('build', 'data.json');
  return {
    name: 'family-data',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      if (!existsSync(dataPath)) this.error(`${dataPath} not found. Run "npm run parse" (or "npm run parse:demo") first.`);
      this.addWatchFile(dataPath);
      const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
      return `export default ${JSON.stringify({ ...data, geo: extractGeo() })};`;
    },
  };
}
