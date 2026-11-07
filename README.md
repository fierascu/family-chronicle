# Family Chronicle

Turns a GEDCOM family tree export into a single HTML page with a zoomable timeline and a linked globe map.

- One timeline row per family branch, plus a history row
- Lifespans as bars; hatched when a date is estimated
- Three event categories, shown by colour and shape:
  - **Sure** (green circle): dated facts from the tree
  - **Plausible** (orange diamond): estimated dates, or history that likely touched a named relative
  - **Context** (blue square): history of the time and place, no claimed personal link
- The map shows only events in the years visible on the timeline, with migration lines between a person's places
- A list of data problems found in the tree (possible duplicates, contradictions, missing dates, places without a map location)

## Project layout

```
index.html          page markup
src/                the app in TypeScript (no family data)
  main.ts             start-up: header, filters, search
  timeline.ts         vis-timeline rows and items
  globe.ts            D3 globe: canvas background, pins, migration lines
  card.ts             record card (person, event, place)
  data.ts             loads the parsed tree, family links
  types.ts            shape of the parsed data
  style.css
scripts/
  parse_gedcom.py     GEDCOM + config -> build/data.json
  family-data-plugin.ts  Vite plugin: serves build/data.json and the country outlines to the app
public/             .htaccess and robots.txt, copied into dist/
demo/               fictional demo tree, committed
  dummy.ged           2 families, 10 people
  dummy.config.json   settings and history events for the demo
data/               your own tree, gitignored
  tree.ged            your GEDCOM export
  tree.config.json    settings for your tree (optional)
build/, dist/       generated, gitignored
```

## Requirements

- Node.js 20.19+ (Vite build)
- Python 3.9+ (GEDCOM parser, no extra packages)

## Quick start (demo)

```bash
npm install
npm run dev
```

`npm run dev` parses the tree and opens a live-reloading page. Without `data/tree.ged`, it uses the demo tree in `demo/`.

To build the static site and look at it:

```bash
npm run build
npm run preview
```

The page is built as ES modules, so `dist/index.html` must be served over HTTP (`npm run preview` or any web server); opening the file directly from disk does not work.

## Use your own tree

Put your export at `data/tree.ged`. It replaces the demo automatically:

```bash
mkdir -p data
cp ~/Downloads/your-export.ged data/tree.ged
cp demo/dummy.config.json data/tree.config.json   # optional starting point, edit for your tree
npm run build
```

| Command | Does |
|---|---|
| `npm run dev` / `npm run build` | parse `data/tree.ged` if it exists, else `demo/dummy.ged`; then serve / build |
| `npm run dev:demo` / `npm run build:demo` | same, always with `demo/dummy.ged` |
| `python scripts/parse_gedcom.py path/to/x.ged` then `npx vite build` | any file; config read from `path/to/x.config.json` |
| `npm run preview` | serve the built `dist/` locally |
| `npm run typecheck` | TypeScript check of the app and build scripts |

The parser prints which input and config it used.

## How it works

| Step | File | Output |
|---|---|---|
| Parse GEDCOM + config: normalise dates and places, estimate missing years, assign branches, add history events, run data checks | `scripts/parse_gedcom.py` | `build/data.json` |
| Add the outlines of Romania and its neighbours, cut from Natural Earth (`world-atlas`), and hand everything to the app as `virtual:family-data` | `scripts/family-data-plugin.ts` | (in the bundle) |
| Bundle the app, libraries, fonts and world maps | Vite | `dist/` |

Everything is bundled: [vis-timeline](https://visjs.github.io/vis-timeline/), [D3](https://d3js.org/), the fonts (Fontsource) and the world maps. The page makes no requests to other sites, so it works offline and leaks nothing to CDNs. The detailed world maps are separate files, loaded only when you zoom in on the globe.

## Configuration

The code holds no family data. Everything specific to one tree goes in `<name>.config.json` next to the GEDCOM file. The file and every key in it are optional.

| Key | What it does |
|---|---|
| `settings.historyLabel` | Name of the history row (default `History`) |
| `settings.homeCountry` | Country highlighted on the globe (default `Romania`) |
| `settings.timelineStart` | First year shown (default: the decade before the earliest birth) |
| `settings.startEvent` | Title prefix of the event opened on load (default: first plausible history event) |
| `settings.livingYears` | People without a death record born within this many years count as living (default 100) |
| `places` | Place key → `label`, `lat`, `lon`, `approx` (approximate pin) |
| `placeRules` | `{contains, place}`: map messy place strings to a place key (`"Lisabona"` → `"Lisbon"`) |
| `branches` | Surname → branch name. Order sets branch colours |
| `noteEvents` | Facts from free-text notes: `person`, `year`, `place`, `title`, `text` (shown as plausible) |
| `history` | Historical events: `cat` (`plausible` or `context`), `start`, `end`, `place`, `title`, `text`, `link`, `people` |
| `placeNotes` | Extra "things to fix" lines: `text`, shown when a raw place contains all strings in `rawPlaceContains` |

Example:

```json
{
  "settings": { "historyLabel": "Romania", "startEvent": "WWII" },
  "places": { "Craiova": { "label": "Craiova, Dolj", "lat": 44.32, "lon": 23.80, "approx": false } },
  "placeRules": [ { "contains": "Lisabona", "place": "Lisbon" } ],
  "branches": { "popescu": "Popescu", "ionescu": "Popescu" },
  "history": [
    { "cat": "plausible", "start": 1941, "end": 1945, "title": "WWII draft",
      "text": "Check military records.", "link": "https://en.wikipedia.org/wiki/Romania_in_World_War_II",
      "people": ["I5"] }
  ]
}
```

Notes:

- **Places.** A place can also carry its coordinates inside the GEDCOM file, with the standard `PLAC` › `MAP` › `LATI`/`LONG` tags. The demo does this. Place names with no location are listed under "Things to fix".
- **Branches.** Without `branches`, each person's branch is their birth surname. Spouses who married in (with a married name and no parents in the tree) join the married surname. With `branches`, surnames not in the map join a relative's branch, or `Other`.
- **History.** A `plausible` history event whose `people` aren't in the tree is shown as `context`.
- **Map.** To map a different country, change `COUNTRIES` (and `REGION`) in `scripts/family-data-plugin.ts` and set `settings.homeCountry`.

## Deploying

Upload the contents of `dist/` (including the hidden `.htaccess`). `.htaccess`, `robots.txt` and a `noindex` meta tag stop search engines indexing the page. Asset URLs are relative, so any sub-folder works.

## Privacy

- Email addresses are dropped.
- People who may be living (no death record, born within `livingYears`) show their birth year only.
- `.gitignore` excludes `data/`, `*.ged`, `build/` and `dist/`, because the generated page still contains names of living people, including children. Only the fictional `demo/` data is committed.

Keep the repository private, or publish only the code.

## Known limits

- Place coordinates are typed by hand; small villages are approximate.
- Historical events are a starting set, not research results. Each links to a source to check.
- Only `BIRT`, `DEAT`, `MARR`, `DIV`, `OCCU`, `EDUC`, `NOTE` and the "Death of Spouse" event are read so far.
- Dates must be plain (`12 FEB 1898`, `FEB 1898`, `1898`); qualifiers like `ABT` or `BET … AND …` aren't supported yet and stop the build.
