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
scripts/            generic build code (no family data)
src/template.html   the page (no family data)
demo/               fictional demo tree, committed
  dummy.ged           2 families, 10 people
  dummy.config.json   settings and history events for the demo
data/               your own tree, gitignored
  tree.ged            your GEDCOM export
  tree.config.json    settings for your tree (optional)
build/, dist/       generated, gitignored
usefull/            .htaccess and robots.txt for deployment
```

## Requirements

- Node.js 18+ (map outlines)
- Python 3.9+ (no extra packages)

## Quick start (demo)

```bash
npm install
npm run build
open dist/index.html
```

Without `data/tree.ged`, the build uses the demo tree in `demo/`.

## Use your own tree

Put your export at `data/tree.ged`. It replaces the demo automatically:

```bash
mkdir -p data
cp ~/Downloads/your-export.ged data/tree.ged
cp demo/dummy.config.json data/tree.config.json   # optional starting point, edit for your tree
npm run build
```

| Command | Builds from |
|---|---|
| `npm run build` | `data/tree.ged` if it exists, else `demo/dummy.ged` |
| `npm run build:demo` | always `demo/dummy.ged` |
| `python3 scripts/parse_gedcom.py path/to/x.ged` then `python3 scripts/build.py` | any file; config read from `path/to/x.config.json` |

The parser prints which input and config it used.

## How it works

| Step | File | Output |
|---|---|---|
| Map outlines (Romania and neighbours) from Natural Earth via `world-atlas` | `scripts/extract_map.js` | `build/geo.json` |
| Parse GEDCOM + config: normalise dates and places, estimate missing years, assign branches, add history events, run data checks | `scripts/parse_gedcom.py` | `build/data.json` |
| Inject data into the page | `scripts/build.py` + `src/template.html` | `dist/index.html` |

The page loads [vis-timeline](https://visjs.github.io/vis-timeline/) and [D3](https://d3js.org/) from CDNs and works offline otherwise.

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
- **Map.** To map a different country, change the country IDs in `scripts/extract_map.js` and set `settings.homeCountry`.

## Deploying

Publish `dist/index.html`, plus `usefull/.htaccess` and `usefull/robots.txt` to stop search engines crawling the folder.

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
