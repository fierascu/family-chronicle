/** Shape of the parsed tree (scripts/parse-gedcom.ts) plus `geo` (added by the Vite plugin, scripts/family-data-plugin.ts). */

export type Category = 'sure' | 'plausible' | 'context' | 'fun';

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
  /** source page, e.g. an Arcanum newspaper page */
  link?: string;
  /** newspaper page images (file names in clippings/) */
  images?: string[];
}

export interface FamilyEvent extends EventBase {
  kind: 'family';
  person: string;
  partner?: string;
}

export interface HistoryEvent extends EventBase {
  kind: 'history';
  person: null;
  people: string[];
  end: number | null;
}

export type ChronicleEvent = FamilyEvent | HistoryEvent;

export interface SurnameInfo {
  name: string;
  /** ids of people with this birth or married surname (or one of its variants) */
  people: string[];
  /** spellings found in the tree, with the earliest birth year seen */
  spellings: { spelling: string; from: number | null }[];
  /** the rest comes from config "surnames" */
  meaning?: string;
  origin?: string;
  variants?: string[];
  changes?: { when: string; text: string; link?: string }[];
  link?: string;
}

export interface Settings {
  historyLabel?: string;
  homeCountry?: string;
  timelineStart?: number | null;
  startEvent?: string | null;
  /** how living people are shown: in full (default), by initials, or as "Living person" */
  livingPeople?: 'initials' | 'hidden' | 'full';
  causeOfDeath?: boolean;
}

/** config "sources": a readable name and description for links to one site (keyed by host name) */
export interface SourceInfo {
  host: string;
  name?: string;
  about?: string;
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
  surnames?: SurnameInfo[];
  settings?: Settings;
  /** the program that exported the GEDCOM and the export date, from its header (the file itself is never published) */
  tree?: { program?: string; exported?: string };
  sources?: SourceInfo[];
  /** translations of the hand-written texts, by language, keyed by the text as written (<tree>.i18n.json) */
  i18n?: Partial<Record<string, Record<string, string>>>;
  geo: CountryOutline[];
}
