/** Shape of build/data.json (written by scripts/parse_gedcom.py) plus `geo` (added by the Vite plugin). */

export type Category = 'sure' | 'plausible' | 'context';

export interface DateValue {
  y: number;
  m?: number;
  d?: number;
  /** `est` = estimated year */
  prec: 'day' | 'month' | 'year' | 'est';
}

export interface Person {
  id: string;
  given: string;
  surname: string;
  married: string;
  sex: string;
  branch: string;
  living: boolean;
  dead: boolean;
  /** families this person is a child in */
  famc: string[];
  /** families this person is a spouse in */
  fams: string[];
  name: string;
  notes: string[];
  /** birth year, recorded or estimated */
  by: number | null;
  byEst: boolean;
  dy: number | null;
  bp: string | null;
  dp: string | null;
}

export interface Place {
  label: string;
  lat: number;
  lon: number;
  approx: boolean;
}

interface EventBase {
  /** assigned on load: e0, e1, … */
  id: string;
  cat: Category;
  type: string;
  date: DateValue;
  /** key into `places`, or null when the place has no map location */
  place: string | null;
  title: string;
  text: string;
}

export interface FamilyEvent extends EventBase {
  kind: 'family';
  person: string;
  partner?: string;
  raw: string | null;
}

export interface HistoryEvent extends EventBase {
  kind: 'history';
  person: null;
  people: string[];
  end: number | null;
  link?: string;
}

export type ChronicleEvent = FamilyEvent | HistoryEvent;

export interface Settings {
  historyLabel?: string;
  homeCountry?: string;
  timelineStart?: number | null;
  startEvent?: string | null;
}

export interface CountryOutline {
  name: string;
  polys: number[][][][];
}

export interface ChronicleData {
  people: Record<string, Person>;
  places: Record<string, Place>;
  events: Omit<ChronicleEvent, 'id'>[];
  checks: string[];
  branches?: string[];
  settings?: Settings;
  geo: CountryOutline[];
}
