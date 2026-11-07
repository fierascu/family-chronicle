/**
 * Vite plugin: serves `virtual:family-data` = the parsed GEDCOM tree (parse-gedcom.ts)
 * plus `geo`, the outlines of the home country and its neighbours cut from Natural Earth (world-atlas).
 *
 * Input: the `GEDCOM` variable (shell or .env file) if set, else data/tree.ged if it exists, else the demo.
 * `--mode demo` always uses the demo. The tree and its config are watched, so `npm run dev` reloads on edits.
 * The data problems found in the tree (with full names) go to build/checks.txt, not the page.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, relative, resolve } from 'node:path';
import { loadEnv, type Logger, type Plugin } from 'vite';
import { configPathFor, parseGedcom } from './parse-gedcom';
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
  let root = process.cwd();
  let gedPath = '';
  let logger: Logger | undefined;
  return {
    name: 'family-data',
    configResolved(config) {
      root = config.root;
      logger = config.logger;
      const real = resolve(root, 'data', 'tree.ged'), demo = resolve(root, 'demo', 'dummy.ged');
      const env = loadEnv(config.mode, root, 'GEDCOM').GEDCOM;
      gedPath = config.mode === 'demo' ? demo : env ? resolve(root, env) : existsSync(real) ? real : demo;
    },
    configureServer(server) {
      // re-parse and reload the page when the tree or its config changes (also outside the project folder)
      const watched = [gedPath, configPathFor(gedPath)];
      server.watcher.add(watched);
      const onChange = (file: string) => {
        if (!watched.includes(resolve(file))) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      if (!existsSync(gedPath)) this.error(`GEDCOM file not found: ${gedPath}`);
      let result;
      try {
        result = parseGedcom(gedPath);
      } catch (e) {
        this.error(`${relative(root, gedPath)}: ${(e as Error).message}`);
      }
      const rel = (p: string) => relative(root, p);
      const log = (line: string) => logger?.info(`[family-data] ${line}`);
      log(`input: ${rel(gedPath)} | config: ${result.configPath ? rel(result.configPath) : 'none'}`);
      result.summary.forEach(log);
      const build = resolve(root, 'build');
      mkdirSync(build, { recursive: true });
      writeFileSync(resolve(build, 'checks.txt'), `Things to fix in ${basename(gedPath)} (full names; not part of the page)

`
        + result.report.map(c => `- ${c}
`).join(''));
      return `export default ${JSON.stringify({ ...result.data, geo: extractGeo() })};`;
    },
  };
}
