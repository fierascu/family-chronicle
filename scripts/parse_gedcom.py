"""Parse a GEDCOM file into build/data.json.

Input: the path given as argument, else data/tree.ged if it exists, else the demo (demo/dummy.ged).
Everything specific to one tree (places, branches, history, notes) lives next to the GEDCOM file
in <name>.config.json -- see demo/dummy.config.json. This script holds no family data.

Output: build/data.json (bundled into the page, so everything in it is public to anyone who can open the page)
and build/checks.txt (data problems with full names, for you only; never bundled unless settings.checksOnPage).
"""
import os, sys, datetime, json, re, html
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
REAL, DEMO = os.path.join(ROOT, "data", "tree.ged"), os.path.join(ROOT, "demo", "dummy.ged")
GED = sys.argv[1] if len(sys.argv) > 1 else (REAL if os.path.exists(REAL) else DEMO)
CFG_PATH = os.path.splitext(GED)[0] + '.config.json'
CFG = json.load(open(CFG_PATH, encoding='utf-8-sig')) if os.path.exists(CFG_PATH) else {}
SETTINGS = {'historyLabel': 'History', 'homeCountry': 'Romania', 'timelineStart': None, 'startEvent': None,
            'livingYears': 100, 'livingPeople': 'initials', 'causeOfDeath': False, 'checksOnPage': False} | CFG.get('settings', {})
if SETTINGS['livingPeople'] not in ('initials', 'hidden', 'full'):
    sys.exit(f"settings.livingPeople must be \"initials\", \"hidden\" or \"full\", not {SETTINGS['livingPeople']!r}")
# Living people are protected unless the config asks for "full" (only for a page that is password-protected)
PROTECT = SETTINGS['livingPeople'] != 'full'

lines = open(GED, encoding='utf-8-sig').read().splitlines()

# ---- generic GEDCOM tree ----
recs = []
stack = []
for ln in lines:
    m = re.match(r'^(\d+)\s+(@[^@]+@\s+)?(\S+)\s?(.*)$', ln)
    if not m:
        # continuation of HTML note without level
        if stack:
            stack[-1]['val'] += '\n' + ln
        continue
    lvl = int(m.group(1)); xref = (m.group(2) or '').strip(); tag = m.group(3); val = m.group(4)
    node = {'tag': tag, 'val': val, 'xref': xref, 'kids': []}
    if lvl == 0:
        recs.append(node); stack = [node]
    else:
        stack = stack[:lvl]
        stack[-1]['kids'].append(node); stack.append(node)

def kid(n, tag):
    for k in n['kids']:
        if k['tag'] == tag: return k
def kids(n, tag): return [k for k in n['kids'] if k['tag'] == tag]
def walk(n):
    yield n
    for k in n['kids']: yield from walk(k)
def clean_note(v):
    v = re.sub(r'<[^>]+>', ' ', v); v = html.unescape(v).replace('\xa0', ' ')
    return scrub(re.sub(r'\s+', ' ', v).strip())
EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
NUMBER_RE = re.compile(r'(?<!\w)\+?\(?\d[\d\s().\-/]{7,}\d(?!\w)')
def _number(m):
    groups = re.findall(r'\d+', m.group())
    if sum(map(len, groups)) < 9: return m.group()  # dates like 12.03.1950 and ranges like 1941-1945
    if all(len(g) == 4 and g[0] in '12' for g in groups): return m.group()  # a list of years
    return '[number removed]'
def scrub(v):
    """Remove email addresses and long numbers (phone numbers, personal ID numbers such as the CNP) from free text."""
    return NUMBER_RE.sub(_number, EMAIL_RE.sub('[email removed]', v))

MON = {m: i+1 for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split())}
def parse_date(s):
    if not s: return None
    p = s.split()
    if len(p) == 3: return {'y': int(p[2]), 'm': MON[p[1]], 'd': int(p[0]), 'prec': 'day'}
    if len(p) == 2: return {'y': int(p[1]), 'm': MON[p[0]], 'prec': 'month'}
    return {'y': int(p[0]), 'prec': 'year'}

# ---- places: config "places"/"placeRules", plus coordinates given in the GEDCOM (PLAC > MAP > LATI/LONG) ----
PLACES = {k: (v['label'], v['lat'], v['lon'], v.get('approx', False)) for k, v in CFG.get('places', {}).items()}
PLACE_RULES = [(r['contains'], r['place']) for r in CFG.get('placeRules', [])]
def fold(s):
    for a, b in zip('ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT'): s = s.replace(a, b)
    return s
def coord(v):
    v = v.strip()
    return (-1 if v[:1] in 'SWsw' else 1) * float(v.lstrip('NSEWnsew'))
for r in recs:
    for n in walk(r):
        mp = kid(n, 'MAP') if n['tag'] == 'PLAC' else None
        if mp and kid(mp, 'LATI') and kid(mp, 'LONG') and n['val'] not in PLACES:
            PLACES[n['val']] = (n['val'], coord(kid(mp, 'LATI')['val']), coord(kid(mp, 'LONG')['val']), False)
def norm_place(raw):
    if not raw: return None, None
    if raw in PLACES: return raw, raw
    f = fold(raw)
    for k, v in PLACE_RULES:
        if fold(k) in f: return v, raw
    for k in PLACES:
        if fold(k) in f: return k, raw
    return None, raw

# ---- people ----
people = {}; fams = {}
for r in recs:
    if r['tag'] == 'INDI':
        nm = kid(r, 'NAME')
        giv = (kid(nm, 'GIVN') or {}).get('val', '').strip() if nm else ''
        sur = (kid(nm, 'SURN') or {}).get('val', '').strip() if nm else ''
        mar = (kid(nm, 'MARN') or kid(nm, '_MARNM') or {}).get('val', '').strip() if nm else ''
        p = {'id': r['xref'].strip('@'), 'given': giv, 'surname': sur, 'married': mar,
             'sex': (kid(r, 'SEX') or {}).get('val', ''), 'fams': [k['val'].strip('@') for k in kids(r, 'FAMS')],
             'famc': [k['val'].strip('@') for k in kids(r, 'FAMC')], 'events': [], 'notes': []}
        for tag in ('BIRT', 'DEAT'):
            e = kid(r, tag)
            if e:
                d = parse_date((kid(e, 'DATE') or {}).get('val'))
                pk, raw = norm_place((kid(e, 'PLAC') or {}).get('val'))
                cause = (kid(e, 'CAUS') or {}).get('val')
                p[tag.lower()] = {'date': d, 'place': pk, 'rawPlace': raw, 'cause': cause}
        for tag, lab in (('OCCU', 'Occupation'), ('EDUC', 'Education / work')):
            e = kid(r, tag)
            if e: p['notes'].append(f"{lab}: {scrub(e['val'])}")
        for n in kids(r, 'NOTE'):
            p['notes'].append(clean_note(n['val']))
        people[p['id']] = p
    elif r['tag'] == 'FAM':
        f = {'id': r['xref'].strip('@'), 'husb': (kid(r, 'HUSB') or {}).get('val', '').strip('@') or None,
             'wife': (kid(r, 'WIFE') or {}).get('val', '').strip('@') or None,
             'chil': [k['val'].strip('@') for k in kids(r, 'CHIL')], 'div': bool(kid(r, 'DIV')),
             'spouseDeath': any((kid(k, 'TYPE') or {}).get('val') == 'Death of Spouse' for k in kids(r, 'EVEN'))}
        m = kid(r, 'MARR')
        if m:
            pk, raw = norm_place((kid(m, 'PLAC') or {}).get('val'))
            f['marr'] = {'date': parse_date((kid(m, 'DATE') or {}).get('val')), 'place': pk, 'rawPlace': raw}
        fams[f['id']] = f

def by(pid): return people.get(pid)
def year(p, k='birt'):
    e = p.get(k); return e and e['date'] and e['date']['y']

# ---- estimate missing birth years (orange) from relatives ----
for _ in range(6):
    for p in people.values():
        if year(p) or p.get('estBirth'): continue
        cands = []; why = []
        for fid in p['fams']:
            f = fams[fid]
            ys = [year(by(c)) or (by(c).get('estBirth') or {}).get('y') for c in f['chil']]
            ys = [y for y in ys if y]
            if ys: cands.append(min(ys) - 27); why.append('about 27 years before the eldest known child')
            sp = f['wife'] if f['husb'] == p['id'] else f['husb']
            if sp and year(by(sp)): cands.append(year(by(sp)) + (2 if p['sex'] == 'M' else -2) * -1); why.append('near the spouse\'s birth year')
        for fid in p['famc']:
            f = fams[fid]
            sib = [year(by(c)) for c in f['chil'] if c != p['id'] and year(by(c))]
            if sib: cands.append(round(sum(sib) / len(sib))); why.append('near the siblings\' birth years')
        if cands:
            p['estBirth'] = {'y': min(cands) if 'child' in why[0] else cands[0], 'why': why[0]}

# ---- living / privacy: no death record and born within the last `livingYears` years ----
LIVING_FROM = datetime.date.today().year - SETTINGS['livingYears']
for p in people.values():
    by_ = year(p) or (p.get('estBirth') or {}).get('y')
    p['dead'] = 'deat' in p
    p['living'] = (not p['dead']) and (by_ is None or by_ >= LIVING_FROM)

# ---- branches ----
# With config "branches" (surname -> branch): mapped surnames; others join a relative's branch, else 'Other'.
# Without it: birth surname, and people who married into the tree (married name, no parents in the tree)
# join their married surname.
BR = CFG.get('branches', {})
def key(s): return fold(s).lower().replace('ş', 's').strip()
BRK = {key(k): v for k, v in BR.items()}
for p in people.values():
    if BR: p['branch'] = BRK.get(key(p['surname'])) or BRK.get(key(p['married']))
    else:  p['branch'] = (p['married'] if p['married'] and not p['famc'] else p['surname']) or None
for _ in range(4):
    for p in people.values():
        if p['branch']: continue
        for fid in p['fams'] + p['famc']:
            f = fams[fid]
            for o in [f['husb'], f['wife']] + f['chil']:
                if o and o != p['id'] and by(o)['branch']: p['branch'] = by(o)['branch']; break
            if p['branch']: break
for p in people.values(): p['branch'] = p['branch'] or 'Other'
if PROTECT:  # a branch made only of living people would publish their surname as its name
    _dead_branches = {p['branch'] for p in people.values() if not p['living']}
    for p in people.values():
        if p['branch'] not in _dead_branches: p['branch'] = 'Other'
# Branch list for the page: config order (keeps colours stable), only branches that have people, 'Other' always last
_bcount = Counter(p['branch'] for p in people.values())
_border = list(dict.fromkeys(BR.values()))
BRANCHES = ([b for b in _border if _bcount[b]] + sorted(b for b in _bcount if b not in _border and b != 'Other')
            + (['Other'] if _bcount['Other'] else []))

def real_name(p):
    g = p['given'] or '(name unknown)'
    s = p['surname'] if p['surname'] not in ('', '?') else ''
    return (g + ' ' + s).strip()
def initials(s): return ' '.join(w[0] + '.' for w in s.split() if w[:1].isalpha())
def hidden(p): return PROTECT and p['living']
def display(p):
    """Name as published: living people get initials or "Living person" unless settings.livingPeople is "full"."""
    if not hidden(p): return real_name(p)
    if SETTINGS['livingPeople'] == 'hidden': return 'Living person'
    return initials(real_name(p)) or 'Living person'

# ---- build family events ----
events = []
def add(**kw): events.append(kw)
for p in people.values():
    nm = display(p)
    for k, label in (('birt', 'Born'), ('deat', 'Died')):
        e = p.get(k)
        if not e: continue
        d = e['date']
        if d:
            if p['living'] and k == 'birt':  # privacy: year only for living people
                d = {'y': d['y'], 'prec': 'year'}
            cause = e.get('cause') if SETTINGS['causeOfDeath'] else None
            add(kind='family', cat='sure', type=k, person=p['id'], date=d, place=None if hidden(p) else e['place'],
                title=f"{label}: {nm}", text=(f"Cause: {scrub(cause)}" if cause else ''), raw=e['rawPlace'])
        elif k == 'birt' and p.get('estBirth'):
            add(kind='family', cat='plausible', type=k, person=p['id'], date={'y': p['estBirth']['y'], 'prec': 'est'},
                place=None if hidden(p) else e['place'], title=f"Born (estimated): {nm}", text=f"Year estimated {p['estBirth']['why']}.", raw=e['rawPlace'])
    if not p.get('birt') and p.get('estBirth') and not p['living']:
        add(kind='family', cat='plausible', type='birt', person=p['id'], date={'y': p['estBirth']['y'], 'prec': 'est'},
            place=None, title=f"Born (estimated): {display(p)}", text=f"Year estimated {p['estBirth']['why']}.", raw=None)
for f in fams.values():
    m = f.get('marr')
    names = ' & '.join(display(by(x)) for x in (f['husb'], f['wife']) if x)
    # a marriage with a living spouse: year only, no place
    shield = any(hidden(by(x)) for x in (f['husb'], f['wife']) if x)
    if m and m['date']:
        d = {'y': m['date']['y'], 'prec': 'year'} if shield else m['date']
        add(kind='family', cat='sure', type='marr', person=f['husb'] or f['wife'], partner=f['wife'], date=d,
            place=None if shield else m['place'], title=f"Married: {names}", text='', raw=m['rawPlace'])
    elif m:
        ys = [year(by(c)) for c in f['chil'] if year(by(c))]
        if ys:
            add(kind='family', cat='plausible', type='marr', person=f['husb'] or f['wife'], partner=f['wife'],
                date={'y': min(ys) - 1, 'prec': 'est'}, place=None if shield else m['place'], title=f"Married (estimated): {names}",
                text='Year estimated as one year before the eldest known child.', raw=m['rawPlace'])

# ---- facts taken from notes (config "noteEvents"; dated by inference -> plausible, or "cat": "fun" for family stories) ----
for n in CFG.get('noteEvents', []):
    if n['person'] not in people: continue
    if hidden(people[n['person']]): continue  # config text names the person: not published for living people
    add(kind='family', cat='fun' if n.get('cat') == 'fun' else 'plausible', type='resi', person=n['person'], date={'y': n['year'], 'prec': 'est'},
        place=n.get('place'), title=n['title'], text=n.get('text', ''), raw=None)

# ---- historical events (config "history"): plausible links (orange), context (blue), fun (magenta) ----
for h in CFG.get('history', []):
    linked = [x for x in h.get('people', []) if x in people]
    cat = 'context' if h['cat'] == 'plausible' and not linked else h['cat']  # no linked relative in this tree
    add(kind='history', cat=cat, type='hist', person=None, people=linked,
        date={'y': h['start'], 'prec': 'year'}, end=h.get('end'), place=h.get('place'), title=h['title'],
        text=h.get('text', ''), link=h.get('link'))

# ---- data checks: written to build/checks.txt with full names; on the page only with settings.checksOnPage ----
def data_checks(name):
    checks = []
    # possible duplicates: same name and married name, birth years unknown or within 15 years
    groups = {}
    for p in people.values():
        if name is not real_name and hidden(p): continue  # page version: no hidden names, and no false "Living person" matches
        if p['given'] and p['given'] != '?':
            groups.setdefault((name(p), p['married']), []).append(year(p) or (p.get('estBirth') or {}).get('y'))
    for (nm, mar), ys in groups.items():
        known = [y for y in ys if y]
        if len(ys) > 1 and (len(known) < 2 or max(known) - min(known) <= 15):
            checks.append(f'{len(ys)} people named {nm}' + (f' (married {mar})' if mar else '') + ' with different parents — possibly one person entered more than once.')
    for f in fams.values():
        if f['div'] and f['spouseDeath']:
            names = ' & '.join(name(by(x)) for x in (f['husb'], f['wife']) if x)
            checks.append(f'{names}: the family has both "Death of Spouse" and "Divorced" — one is probably wrong.')
    unnamed = [p for p in people.values() if not p['given'] or p['given'] in ('?',)]
    checks.append(f'{len(unnamed)} people have no given name.')
    nodate = [p for p in people.values() if p['dead'] and not (p['deat'] or {}).get('date')]
    checks.append(f'{len(nodate)} deaths have no date.')
    raws = [fold(e['raw']) for e in events if e.get('raw')]
    for n in CFG.get('placeNotes', []):  # config "placeNotes": shown when a raw place contains all the given strings
        if any(all(fold(x) in r for x in n['rawPlaceContains']) for r in raws): checks.append(n['text'])
    # from the records, not the events: a living person's place is left out of the events on purpose
    recs_with_place = [p.get(k) for p in people.values() for k in ('birt', 'deat')] + [f.get('marr') for f in fams.values()]
    unplaced = sorted({r['rawPlace'] for r in recs_with_place if r and r['rawPlace'] and not r['place']})
    if unplaced:
        checks.append(f'{len(unplaced)} place names have no map location: ' + '; '.join(unplaced[:10]) + ('…' if len(unplaced) > 10 else ''))
    return checks

# ---- family names (config "surnames"): meaning, origin, variants, changes over time ----
# One entry per surname in the tree (birth or married). A config entry also claims the tree surnames
# listed in its "variants". Spellings found in the tree are listed with the earliest birth year seen.
SN_CFG = CFG.get('surnames', {})
sn_of = {}  # surname key -> entry name
for name, info in SN_CFG.items():
    for s in [name] + info.get('variants', []): sn_of.setdefault(key(s), name)
surnames = {}
# Protected living people come last and only join names already found on others: a name or spelling
# carried only by living people is not published.
for p in sorted(people.values(), key=hidden):
    for s in {p['surname'], p['married']}:
        if not s or s == '?': continue
        name = sn_of.get(key(s)) or sn_of.setdefault(key(s), s)
        if hidden(p):
            if name in surnames and p['id'] not in surnames[name]['people']: surnames[name]['people'].append(p['id'])
            continue
        e = surnames.setdefault(name, {'name': name, 'people': [], 'spellings': {}})
        if p['id'] not in e['people']: e['people'].append(p['id'])
        y = year(p) or (p.get('estBirth') or {}).get('y')
        sp = e['spellings']
        if s not in sp or (y and (sp[s] is None or y < sp[s])): sp[s] = y
for name, e in surnames.items():
    info = SN_CFG.get(name, {})
    e.update({k: info[k] for k in ('meaning', 'origin', 'variants', 'changes', 'link') if k in info})
    e['spellings'] = [{'spelling': s, 'from': y} for s, y in sorted(e['spellings'].items(), key=lambda kv: (kv[1] or 9999, kv[0]))]
surnames = sorted(surnames.values(), key=lambda e: (-len(e['people']), fold(e['name'])))
undescribed = [e['name'] for e in surnames if e['name'] not in SN_CFG]
def all_checks(name):
    checks = data_checks(name)
    if undescribed:
        checks.append(f'{len(undescribed)} family names have no "about" text yet (config "surnames"): ' + ', '.join(undescribed[:10])
                      + ('…' if len(undescribed) > 10 else ''))
    return checks
report = all_checks(real_name)

def public_person(p):
    out = {k: p[k] for k in ('id', 'given', 'surname', 'married', 'sex', 'branch', 'living', 'dead', 'famc', 'fams')} | {
        'name': display(p), 'notes': p['notes'],
        'by': year(p) or (p.get('estBirth') or {}).get('y'), 'byEst': not year(p),
        'dy': year(p, 'deat'), 'bp': (p.get('birt') or {}).get('place'), 'dp': (p.get('deat') or {}).get('place')}
    if hidden(p):  # living: no notes, no places, names reduced to initials (or nothing)
        short = (lambda v: initials(v)) if SETTINGS['livingPeople'] == 'initials' else (lambda v: '')
        out |= {'given': short(p['given']) or ('Living person' if SETTINGS['livingPeople'] == 'hidden' else ''),
                'surname': short(p['surname']), 'married': short(p['married']), 'notes': [], 'bp': None, 'dp': None}
    return out

# Only places that something on the page points to (the config may list more, e.g. a living person's town)
used_places = {e['place'] for e in events if e.get('place')}
out = {'people': {pid: public_person(p) for pid, p in people.items()},
       'places': {k: {'label': v[0], 'lat': v[1], 'lon': v[2], 'approx': v[3]} for k, v in PLACES.items() if k in used_places},
       # raw place strings stay out of the page: they can be anything the tree's author typed, even an address
       'events': [{k: v for k, v in e.items() if k != 'raw'} for e in events],
       'checks': all_checks(display) if SETTINGS['checksOnPage'] else [], 'branches': BRANCHES, 'surnames': surnames,
       'settings': {k: SETTINGS[k] for k in ('historyLabel', 'homeCountry', 'timelineStart', 'startEvent', 'livingPeople', 'causeOfDeath')}}
os.makedirs(BUILD, exist_ok=True)
json.dump(out, open(os.path.join(BUILD, 'data.json'), 'w', encoding='utf-8'), ensure_ascii=False)
with open(os.path.join(BUILD, 'checks.txt'), 'w', encoding='utf-8') as fh:
    fh.write('Things to fix in ' + os.path.basename(GED) + ' (full names; not part of the page)\n\n'
             + ''.join(f'- {c}\n' for c in report))

enc = sys.stdout.encoding or 'utf-8'
def safe(s): return s.encode(enc, errors='replace').decode(enc)
print('input:', os.path.relpath(GED, ROOT), '| config:', os.path.relpath(CFG_PATH, ROOT) if CFG else 'none')
print(len(people), 'people;', Counter((e['kind'], e['cat']) for e in events))
print(safe('branches: ' + str(Counter(p['branch'] for p in people.values()))))
print(safe(f'privacy: living people {SETTINGS["livingPeople"]} ({sum(hidden(p) for p in people.values())} protected), '
           f'cause of death {"shown" if SETTINGS["causeOfDeath"] else "hidden"}, '
           f'checks {"on the page" if SETTINGS["checksOnPage"] else "in build/checks.txt only"}'))
print(safe(f'{len(report)} things to fix: see build/checks.txt'))
