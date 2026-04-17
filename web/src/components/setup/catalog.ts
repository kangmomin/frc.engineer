type SetupFieldKey =
  | "fw"
  | "rw"
  | "don"
  | "doff"
  | "fs"
  | "rs"
  | "fa"
  | "ra"
  | "frh"
  | "rrh"
  | "bb"
  | "bp"
  | "fl"
  | "fr"
  | "rl"
  | "rr";

export type SetupKey =
  | "ip_r"
  | "ip_q"
  | "ip_i"
  | "ip_w"
  | "es_r"
  | "es_q"
  | "sf_r"
  | "sf_q"
  | "bl_r"
  | "bl_q"
  | "bl_i"
  | "bl_w"
  | "gn_i"
  | "gn_w";

export interface TrackOption {
  name: string;
  badge: string;
  round: number;
  sprint?: boolean;
}

interface TrackSource extends TrackOption {
  normalizedKey: string;
  brendonTrack: string;
}

export interface TeamProfile {
  name: string;
  total: number;
  pros: string;
  cons: string;
  mass: number;
  drag: number;
  aeroF: number;
  aeroR: number;
  gear: number;
  wDist: number;
}

export interface SetupValues {
  fw: number;
  rw: number;
  don: number;
  doff: number;
  fs: number;
  rs: number;
  fa: number;
  ra: number;
  frh: number;
  rrh: number;
  bb: number;
  bp: number;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
  note?: string;
}

export interface TrackGuide {
  notes: string;
  softLife: string;
  medLife: string;
  hardLife: string;
  pitWindow50: string;
  strategy: string;
  ersEnable?: string;
  qualiFuel?: string;
  startingTyre?: string;
}

export type TrackCatalog = Partial<Record<SetupKey, SetupValues>> & {
  track: TrackGuide;
};

export interface SetupMeta {
  key: SetupKey;
  label: string;
  color: string;
  group: string;
  rain: boolean;
  desc: string;
  who: string;
  dbKey?: SetupKey;
}

export interface SetupTag {
  label: string;
  color: string;
}

export interface CompatibilityLabel {
  label: string;
  color: string;
  icon: string;
}

interface NormalizedTrackFile {
  track_info: {
    drs_zones: number;
    pole_position_side: string;
    pit_limit_kph: number;
  };
  tyre_strategy: {
    tyre_life_50pct: {
      soft?: { laps: number };
      medium?: { laps: number };
      hard?: { laps: number };
    };
  };
  quali_strategy?: {
    fuel_amount_kg: number;
    starting_tyre_temp_c: number;
    enable_ers_display: string;
  };
  race_strategy?: {
    available: boolean;
    notes?: string;
    plan_a?: {
      tyres: string[];
      pit_window_display: string;
    };
  };
  setups: {
    dry: NormalizedSetup[];
    wet: NormalizedSetup[];
  };
}

interface NormalizedSetup {
  id: string;
  front_wing: number;
  rear_wing: number;
  on_throttle_differential: number;
  off_throttle_differential: number;
  front_suspension: number;
  rear_suspension: number;
  front_anti_roll_bar: number;
  rear_anti_roll_bar: number;
  front_ride_height: number;
  rear_ride_height: number;
  brake_bias: number;
  brake_pressure: number;
  front_left_pressure: number;
  front_right_pressure: number;
  rear_left_pressure: number;
  rear_right_pressure: number;
  notes?: string | null;
}

interface BrendonLeighFile {
  tracks: BrendonTrack[];
}

interface BrendonTrack {
  track: string;
  race?: BrendonSetupSection;
  qualifying?: BrendonSetupSection;
  intermediates?: BrendonSetupSection;
  wets?: BrendonSetupSection;
}

interface BrendonSetupSection {
  aerodynamics: { front: number; rear: number };
  transmission: { on: number; off: number };
  suspension: { front: number; rear: number };
  rollbars: { front: number; rear: number };
  rideHeight: { front: number; rear: number };
  brakes: { pressure: number; bias: number };
  frontTyres: { left: number; right: number };
  rearTyres: { left: number; right: number };
  notes?: string;
}

const trackSources: TrackSource[] = [
  { name: "Australia", badge: "AU", round: 1, normalizedKey: "australia", brendonTrack: "Australia" },
  { name: "China", badge: "CN", round: 2, sprint: true, normalizedKey: "china", brendonTrack: "China" },
  { name: "Japan", badge: "JP", round: 3, normalizedKey: "japan", brendonTrack: "Japan" },
  { name: "Bahrain", badge: "BH", round: 4, normalizedKey: "bahrain", brendonTrack: "Bahrain" },
  { name: "Saudi Arabia", badge: "SA", round: 5, normalizedKey: "saudi-arabia", brendonTrack: "Jeddah" },
  { name: "United States (Miami)", badge: "US", round: 6, sprint: true, normalizedKey: "miami", brendonTrack: "Miami" },
  { name: "Italy (Imola)", badge: "IT", round: 7, normalizedKey: "imola", brendonTrack: "Imola" },
  { name: "Monaco", badge: "MC", round: 8, normalizedKey: "monaco", brendonTrack: "Monaco" },
  { name: "Spain", badge: "ES", round: 9, normalizedKey: "spain", brendonTrack: "Spain" },
  { name: "Canada", badge: "CA", round: 10, normalizedKey: "canada", brendonTrack: "Canada" },
  { name: "Austria", badge: "AT", round: 11, normalizedKey: "austria", brendonTrack: "Austria + Reverse" },
  { name: "United Kingdom", badge: "UK", round: 12, normalizedKey: "britain", brendonTrack: "Silverstone + Reverse" },
  { name: "Belgium", badge: "BE", round: 13, sprint: true, normalizedKey: "belgium", brendonTrack: "Spa" },
  { name: "Hungary", badge: "HU", round: 14, normalizedKey: "hungary", brendonTrack: "Hungary" },
  { name: "Netherlands", badge: "NL", round: 15, normalizedKey: "netherlands", brendonTrack: "Zandvoort + Reverse" },
  { name: "Italy (Monza)", badge: "IT", round: 16, normalizedKey: "italy", brendonTrack: "Monza" },
  { name: "Azerbaijan", badge: "AZ", round: 17, normalizedKey: "azerbaijan", brendonTrack: "Baku" },
  { name: "Singapore", badge: "SG", round: 18, normalizedKey: "singapore", brendonTrack: "Singapore" },
  { name: "United States (Austin)", badge: "US", round: 19, sprint: true, normalizedKey: "texas", brendonTrack: "COTA (Texas)" },
  { name: "Mexico", badge: "MX", round: 20, normalizedKey: "mexico", brendonTrack: "Mexico" },
  { name: "Brazil", badge: "BR", round: 21, sprint: true, normalizedKey: "brazil", brendonTrack: "Brazil" },
  { name: "United States (Las Vegas)", badge: "US", round: 22, normalizedKey: "las-vegas", brendonTrack: "Vegas" },
  { name: "Qatar", badge: "QA", round: 23, sprint: true, normalizedKey: "qatar", brendonTrack: "Qatar" },
  { name: "United Arab Emirates", badge: "AE", round: 24, normalizedKey: "abu-dhabi", brendonTrack: "Abu Dhabi" },
];

export const TRACKS: TrackOption[] = trackSources.map(({ name, badge, round, sprint }) => ({
  name,
  badge,
  round,
  sprint,
}));

export const TEAM_PROFILES: TeamProfile[] = [
  { name: "Red Bull", total: 55, pros: "Best front aero and strongest total downforce.", cons: "Heaviest package and awkward weight distribution.", mass: 803, drag: 0.01303, aeroF: 3.368, aeroR: 1.9974, gear: 1.6417, wDist: 0.204 },
  { name: "McLaren", total: 54, pros: "Lightest car and excellent rear aero.", cons: "Front aero is only average.", mass: 798, drag: 0.01287, aeroF: 3.24, aeroR: 2.0278, gear: 1.6756, wDist: 0.18 },
  { name: "Mercedes", total: 49, pros: "Good drag efficiency and solid rear stability.", cons: "Overall aero package is mid-table.", mass: 804, drag: 0.0129, aeroF: 3.126, aeroR: 1.9854, gear: 1.6806, wDist: 0.16 },
  { name: "Ferrari", total: 48, pros: "Reasonably light with balanced weight distribution.", cons: "Less efficient drag and weaker total aero.", mass: 801, drag: 0.01369, aeroF: 3.067, aeroR: 1.9378, gear: 1.6853, wDist: 0.165 },
  { name: "Aston Martin", total: 44, pros: "Strong front aero and decent drag number.", cons: "Heavy and weak rear support.", mass: 809, drag: 0.01294, aeroF: 3.207, aeroR: 1.9304, gear: 1.6806, wDist: 0.175 },
  { name: "Alpine", total: 38, pros: "Very low drag, strong gearbox, low weight bias.", cons: "Heavy and weak total aero package.", mass: 807, drag: 0.01276, aeroF: 3.078, aeroR: 1.9264, gear: 1.7081, wDist: 0.158 },
  { name: "Williams", total: 36, pros: "Usable front aero.", cons: "Heavy, draggy, weak rear support.", mass: 810, drag: 0.01377, aeroF: 3.091, aeroR: 1.8405, gear: 1.6806, wDist: 0.187 },
  { name: "Vcarb", total: 32, pros: "Average drag and rear aero.", cons: "Weak front aero and poor gearbox ratio.", mass: 808, drag: 0.01301, aeroF: 2.806, aeroR: 1.91, gear: 1.5133, wDist: 0.2 },
  { name: "Haas", total: 30, pros: "Decent weight balance and gearbox.", cons: "Heavy with weak rear and total aero.", mass: 812, drag: 0.01301, aeroF: 3.013, aeroR: 1.8098, gear: 1.6853, wDist: 0.165 },
  { name: "Sauber", total: 21, pros: "No standout strength.", cons: "Heaviest car, worst drag, weakest aero balance.", mass: 813, drag: 0.01497, aeroF: 2.566, aeroR: 1.6412, gear: 1.6853, wDist: 0.225 },
];

export const SORTED_TEAMS = [...TEAM_PROFILES].sort((a, b) => b.total - a.total);

export const SETUP_FIELD_DEFS: Record<SetupFieldKey, { name: string; min: number; max: number }> = {
  fw: { name: "Front Wing", min: 0, max: 50 },
  rw: { name: "Rear Wing", min: 0, max: 50 },
  don: { name: "On Throttle Diff", min: 10, max: 100 },
  doff: { name: "Off Throttle Diff", min: 10, max: 100 },
  fs: { name: "Front Suspension", min: 1, max: 41 },
  rs: { name: "Rear Suspension", min: 1, max: 41 },
  fa: { name: "Front Anti-Roll Bar", min: 1, max: 21 },
  ra: { name: "Rear Anti-Roll Bar", min: 1, max: 21 },
  frh: { name: "Front Ride Height", min: 15, max: 35 },
  rrh: { name: "Rear Ride Height", min: 40, max: 60 },
  bb: { name: "Brake Bias", min: 50, max: 70 },
  bp: { name: "Brake Pressure", min: 80, max: 100 },
  fl: { name: "Front Left Pressure", min: 22.5, max: 29.5 },
  fr: { name: "Front Right Pressure", min: 22.5, max: 29.5 },
  rl: { name: "Rear Left Pressure", min: 20.5, max: 26.5 },
  rr: { name: "Rear Right Pressure", min: 20.5, max: 26.5 },
};

export const SETUP_FIELDS: Array<{ k: SetupFieldKey; l: string }> = [
  { k: "fw", l: "Front Wing" },
  { k: "rw", l: "Rear Wing" },
  { k: "don", l: "On-Throttle Diff" },
  { k: "doff", l: "Off-Throttle Diff" },
  { k: "fs", l: "Front Suspension" },
  { k: "rs", l: "Rear Suspension" },
  { k: "fa", l: "Front Anti-Roll Bar" },
  { k: "ra", l: "Rear Anti-Roll Bar" },
  { k: "frh", l: "Front Ride Height" },
  { k: "rrh", l: "Rear Ride Height" },
  { k: "bb", l: "Brake Bias" },
  { k: "bp", l: "Brake Pressure" },
  { k: "fl", l: "Front Left PSI" },
  { k: "fr", l: "Front Right PSI" },
  { k: "rl", l: "Rear Left PSI" },
  { k: "rr", l: "Rear Right PSI" },
];

export const RADAR_FIELDS: Array<{ k: SetupFieldKey; l: string }> = [
  { k: "fw", l: "FW" },
  { k: "rw", l: "RW" },
  { k: "don", l: "DON" },
  { k: "doff", l: "DOFF" },
  { k: "fs", l: "FS" },
  { k: "rs", l: "RS" },
  { k: "fa", l: "FA" },
  { k: "ra", l: "RA" },
  { k: "frh", l: "FRH" },
  { k: "rrh", l: "RRH" },
  { k: "bb", l: "BB" },
  { k: "bp", l: "BP" },
];

export const SETUP_META: SetupMeta[] = [
  { key: "ip_r", label: "Puki Race", color: "#a855f7", group: "Istvan Puki", rain: false, desc: "League race baseline", who: "Advanced" },
  { key: "ip_q", label: "Puki Quali", color: "#c084fc", group: "Istvan Puki", rain: false, desc: "Short run baseline", who: "Advanced" },
  { key: "ip_i", label: "Puki Inter", color: "#22c55e", group: "Istvan Puki", rain: true, desc: "Intermediate baseline", who: "Rain" },
  { key: "ip_w", label: "Puki Wet", color: "#3b82f6", group: "Istvan Puki", rain: true, desc: "Full wet baseline", who: "Heavy rain" },
  { key: "es_r", label: "Esports Race", color: "#ec4899", group: "Istvan Puki", rain: false, desc: "Competitive race trim", who: "Intermediate" },
  { key: "es_q", label: "Esports Quali", color: "#f472b6", group: "Istvan Puki", rain: false, desc: "Competitive hotlap trim", who: "Intermediate" },
  { key: "sf_r", label: "Safe Race", color: "#f97316", group: "Istvan Puki", rain: false, desc: "Stable race baseline", who: "Beginner" },
  { key: "sf_q", label: "Safe Quali", color: "#fb923c", group: "Istvan Puki", rain: false, desc: "Stable hotlap baseline", who: "Beginner" },
  { key: "bl_r", label: "BL Race", color: "#eab308", group: "Brendon Leigh", rain: false, desc: "Tyre-management race trim", who: "General" },
  { key: "bl_q", label: "BL Quali", color: "#facc15", group: "Brendon Leigh", rain: false, desc: "Brendon hotlap trim", who: "General" },
  { key: "bl_i", label: "BL Inter", color: "#34d399", group: "Brendon Leigh", rain: true, desc: "Brendon intermediate trim", who: "Rain" },
  { key: "bl_w", label: "BL Wet", color: "#60a5fa", group: "Brendon Leigh", rain: true, desc: "Brendon wet trim", who: "Heavy rain" },
  { key: "gn_i", label: "Inter Setup", color: "#10b981", group: "General", rain: true, desc: "Shared intermediate alias", who: "All", dbKey: "ip_i" },
  { key: "gn_w", label: "Wet Setup", color: "#6366f1", group: "General", rain: true, desc: "Shared wet alias", who: "All", dbKey: "ip_w" },
];

export function getDbKey(meta: SetupMeta): SetupKey {
  return meta.dbKey ?? meta.key;
}

export const SENDER_TRACK_MAP: Record<string, string> = {
  melbourne: "Australia",
  shanghai: "China",
  suzuka: "Japan",
  sakhir: "Bahrain",
  jeddah: "Saudi Arabia",
  saudi_arabia: "Saudi Arabia",
  miami: "United States (Miami)",
  united_states_miami: "United States (Miami)",
  imola: "Italy (Imola)",
  italy_imola: "Italy (Imola)",
  monaco: "Monaco",
  catalunya: "Spain",
  montreal: "Canada",
  austria: "Austria",
  silverstone: "United Kingdom",
  britain: "United Kingdom",
  spa: "Belgium",
  hungaroring: "Hungary",
  zandvoort: "Netherlands",
  monza: "Italy (Monza)",
  italy_monza: "Italy (Monza)",
  baku: "Azerbaijan",
  singapore: "Singapore",
  texas: "United States (Austin)",
  united_states_austin: "United States (Austin)",
  mexico: "Mexico",
  brazil: "Brazil",
  las_vegas: "United States (Las Vegas)",
  united_states_las_vegas: "United States (Las Vegas)",
  losail: "Qatar",
  abu_dhabi: "United Arab Emirates",
  united_arab_emirates: "United Arab Emirates",
};

const normalizedTracks = Object.fromEntries(
  Object.entries(
    import.meta.glob<NormalizedTrackFile>("./data/strategy/normalized/tracks/*.json", {
      eager: true,
      import: "default",
    }),
  ).map(([path, data]) => [path.split(/[\\/]/).pop()!.replace(/\.json$/, ""), data]),
) as Record<string, NormalizedTrackFile>;

const brendonData = Object.values(
  import.meta.glob<BrendonLeighFile>("./data/brendonLeigh_setups.json", {
    eager: true,
    import: "default",
  }),
)[0];

const brendonTracks = new Map(
  (brendonData?.tracks ?? []).map((track) => [track.track, track]),
);

const setupCatalogs = Object.fromEntries(
  trackSources.map((track) => [track.name, buildTrackCatalog(track)]),
) as Record<string, TrackCatalog>;

const trackAliasEntries: Record<string, string> = {
  australia: "Australia",
  melbourne: "Australia",
  albert_park: "Australia",
  china: "China",
  shanghai: "China",
  japan: "Japan",
  suzuka: "Japan",
  bahrain: "Bahrain",
  sakhir: "Bahrain",
  bahrain_international: "Bahrain",
  bahrain_international_circuit: "Bahrain",
  saudi_arabia: "Saudi Arabia",
  "saudi-arabia": "Saudi Arabia",
  jeddah: "Saudi Arabia",
  jeddah_corniche: "Saudi Arabia",
  jeddah_corniche_circuit: "Saudi Arabia",
  miami: "United States (Miami)",
  united_states_miami: "United States (Miami)",
  miami_international_autodrome: "United States (Miami)",
  imola: "Italy (Imola)",
  italy_imola: "Italy (Imola)",
  emilia_romagna: "Italy (Imola)",
  autodromo_enzo_e_dino_ferrari: "Italy (Imola)",
  monaco: "Monaco",
  monte_carlo: "Monaco",
  spain: "Spain",
  catalunya: "Spain",
  barcelona: "Spain",
  canada: "Canada",
  montreal: "Canada",
  circuit_gilles_villeneuve: "Canada",
  austria: "Austria",
  red_bull_ring: "Austria",
  britain: "United Kingdom",
  great_britain: "United Kingdom",
  united_kingdom: "United Kingdom",
  silverstone: "United Kingdom",
  silverstone_circuit: "United Kingdom",
  belgium: "Belgium",
  spa: "Belgium",
  spa_francorchamps: "Belgium",
  spa_francorchamps_circuit: "Belgium",
  hungary: "Hungary",
  hungaroring: "Hungary",
  netherlands: "Netherlands",
  zandvoort: "Netherlands",
  italy_monza: "Italy (Monza)",
  monza: "Italy (Monza)",
  autodromo_nazionale_monza: "Italy (Monza)",
  azerbaijan: "Azerbaijan",
  baku: "Azerbaijan",
  baku_city_circuit: "Azerbaijan",
  singapore: "Singapore",
  marina_bay: "Singapore",
  marina_bay_street_circuit: "Singapore",
  texas: "United States (Austin)",
  cota: "United States (Austin)",
  circuit_of_the_americas: "United States (Austin)",
  united_states_austin: "United States (Austin)",
  mexico: "Mexico",
  autodromo_hermanos_rodriguez: "Mexico",
  brazil: "Brazil",
  interlagos: "Brazil",
  las_vegas: "United States (Las Vegas)",
  "las-vegas": "United States (Las Vegas)",
  vegas: "United States (Las Vegas)",
  las_vegas_strip_circuit: "United States (Las Vegas)",
  united_states_las_vegas: "United States (Las Vegas)",
  qatar: "Qatar",
  losail: "Qatar",
  lusail: "Qatar",
  lusail_international_circuit: "Qatar",
  uae: "United Arab Emirates",
  united_arab_emirates: "United Arab Emirates",
  abu_dhabi: "United Arab Emirates",
  "abu-dhabi": "United Arab Emirates",
  yas_marina: "United Arab Emirates",
  yas_marina_circuit: "United Arab Emirates",
};

function normalizeTrackLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-\/.,()]+/g, " ")
    .replace(/\s+/g, " ");
}

const trackSourceByLookupKey = new Map<string, TrackSource>(
  trackSources.flatMap((track) => {
    const entries: Array<[string, TrackSource]> = [
      [normalizeTrackLookupKey(track.name), track],
      [normalizeTrackLookupKey(track.normalizedKey), track],
      [normalizeTrackLookupKey(track.brendonTrack), track],
    ];
    for (const [alias, name] of Object.entries(trackAliasEntries)) {
      if (name !== track.name) {
        continue;
      }
      entries.push([normalizeTrackLookupKey(alias), track]);
    }
    return entries;
  }),
);

function resolveTrackSource(trackName: string | null | undefined): TrackSource | null {
  if (!trackName) {
    return null;
  }
  return trackSourceByLookupKey.get(normalizeTrackLookupKey(trackName)) ?? null;
}

export function getTrackCatalog(trackName: string | null | undefined): TrackCatalog | null {
  const source = resolveTrackSource(trackName);
  return source ? setupCatalogs[source.name] ?? null : null;
}

export function getTrackOption(trackName: string | null | undefined): TrackOption | null {
  const source = resolveTrackSource(trackName);
  return source ? TRACKS.find((track) => track.name === source.name) ?? null : null;
}

export function getSetupTags(setup: SetupValues): SetupTag[] {
  const tags: SetupTag[] = [];
  const avgWing = (setup.fw + setup.rw) / 2;
  const avgTyre = (setup.fl + setup.fr + setup.rl + setup.rr) / 4;

  if (avgWing >= 35) {
    tags.push({ label: "High DF", color: "#7c3aed" });
  } else if (avgWing >= 20) {
    tags.push({ label: "Balanced", color: "#0891b2" });
  } else {
    tags.push({ label: "Low Drag", color: "#dc2626" });
  }

  if (setup.doff <= 20) {
    tags.push({ label: "Sharp Entry", color: "#ea580c" });
  } else if (setup.doff >= 40) {
    tags.push({ label: "Rear Stable", color: "#16a34a" });
  }
  if (setup.fs >= 38) {
    tags.push({ label: "Stiff Front", color: "#ca8a04" });
  }
  if (setup.rs <= 3) {
    tags.push({ label: "Soft Rear", color: "#0284c7" });
  }
  if (avgTyre <= 22) {
    tags.push({ label: "Low PSI Grip", color: "#9333ea" });
  } else if (avgTyre >= 27) {
    tags.push({ label: "High PSI Save", color: "#15803d" });
  }
  if (setup.bb >= 56) {
    tags.push({ label: "Front Bias", color: "#b45309" });
  }

  return tags;
}

export function getSetupFeel(setup: SetupValues): string {
  const avgWing = (setup.fw + setup.rw) / 2;
  const avgTyre = (setup.fl + setup.fr + setup.rl + setup.rr) / 4;
  const parts: string[] = [];

  if (avgWing >= 40) {
    parts.push("Max wing");
  } else if (avgWing >= 25) {
    parts.push("Medium-high wing");
  } else if (avgWing >= 10) {
    parts.push("Low wing");
  } else {
    parts.push("Minimum wing");
  }

  if (setup.doff <= 20) {
    parts.push("Sharp entry");
  } else if (setup.doff >= 40) {
    parts.push("Stable rear");
  }
  if (setup.rs <= 3) {
    parts.push("High traction");
  }
  if (setup.fs >= 38) {
    parts.push("Fast front response");
  }
  if (avgTyre <= 22) {
    parts.push("Grip-biased PSI");
  } else if (avgTyre >= 27) {
    parts.push("Wear-biased PSI");
  }

  return parts.join(" / ");
}

export function getCompatibilityScore(setup: SetupValues, team?: TeamProfile | null): number | null {
  if (!team) {
    return null;
  }

  let score = 70;
  const avgWing = (setup.fw + setup.rw) / 2;
  const avgTyre = (setup.fl + setup.fr + setup.rl + setup.rr) / 4;
  const lowDragCar = team.drag < 0.013;
  const highWing = avgWing >= 30;

  if (lowDragCar && !highWing) score += 10;
  if (lowDragCar && highWing) score -= 8;
  if (!lowDragCar && highWing) score += 5;
  if (team.aeroF >= 3.3 && setup.fw <= 15) score += 8;
  if (team.aeroF < 2.9 && setup.fw <= 10) score -= 10;
  if (team.aeroR >= 2.0 && setup.doff <= 25) score += 8;
  if (team.aeroR < 1.85 && setup.doff <= 20) score -= 8;
  if (team.mass >= 810 && setup.fs >= 38) score += 5;
  if (team.mass <= 800 && setup.fs <= 30) score += 5;
  if (team.wDist >= 0.2 && setup.bb <= 54) score += 7;
  if (team.wDist <= 0.17 && setup.bb >= 56) score += 5;
  if (team.wDist >= 0.2 && setup.bb >= 57) score -= 7;
  if (team.gear >= 1.67 && setup.don >= 100) score += 5;
  if (team.gear < 1.55 && setup.don >= 100) score -= 5;
  if (team.mass >= 810 && avgTyre <= 24) score += 5;
  if (team.mass <= 800 && avgTyre >= 28) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getCompatibilityLabel(score: number): CompatibilityLabel {
  if (score >= 88) return { label: "Perfect fit", color: "#22c55e", icon: "*" };
  if (score >= 76) return { label: "Good fit", color: "#84cc16", icon: "+" };
  if (score >= 63) return { label: "Usable fit", color: "#eab308", icon: "~" };
  if (score >= 50) return { label: "Weak fit", color: "#f97316", icon: "!" };
  return { label: "Poor fit", color: "#ef4444", icon: "x" };
}

function buildTrackCatalog(track: TrackSource): TrackCatalog {
  const normalized = normalizedTracks[track.normalizedKey];
  const brendon = brendonTracks.get(track.brendonTrack);

  if (!normalized) {
    throw new Error(`Missing normalized setup data for ${track.name}`);
  }

  const catalog: TrackCatalog = {
    track: buildTrackGuide(normalized),
    ip_q: fromNormalized(findSetupById(normalized.setups.dry, "istvan-puki-quali-setup")),
    ip_r: fromNormalized(findSetupById(normalized.setups.dry, "istvan-puki-race-setup")),
    es_q: fromNormalized(findSetupById(normalized.setups.dry, "esports-quali-setup")),
    es_r: fromNormalized(findSetupById(normalized.setups.dry, "esports-race-setup")),
    sf_q: fromNormalized(findSetupById(normalized.setups.dry, "safe-quali-setup")),
    sf_r: fromNormalized(findSetupById(normalized.setups.dry, "safe-race-setup")),
    ip_i: fromNormalized(findSetupById(normalized.setups.wet, "intermediate-setup")),
    ip_w: fromNormalized(findSetupById(normalized.setups.wet, "wet-setup-by-istvan") ?? findSetupById(normalized.setups.wet, "wet-setup")),
    bl_q: fromBrendon(brendon?.qualifying),
    bl_r: fromBrendon(brendon?.race),
    bl_i: fromBrendon(brendon?.intermediates),
    bl_w: fromBrendon(brendon?.wets),
  };

  catalog.gn_i = catalog.ip_i;
  catalog.gn_w = catalog.ip_w;
  return catalog;
}

function buildTrackGuide(track: NormalizedTrackFile): TrackGuide {
  const tyreLife = track.tyre_strategy.tyre_life_50pct;
  const racePlan = track.race_strategy?.plan_a;
  const raceNotes = track.race_strategy?.notes?.trim();
  const quali = track.quali_strategy;

  return {
    notes:
      raceNotes ||
      `${track.track_info.drs_zones} DRS zones. Pole side ${track.track_info.pole_position_side}. Pit limit ${track.track_info.pit_limit_kph} kph.`,
    softLife: formatLaps(tyreLife.soft?.laps),
    medLife: formatLaps(tyreLife.medium?.laps),
    hardLife: formatLaps(tyreLife.hard?.laps),
    pitWindow50: racePlan?.pit_window_display || "No 50% race window",
    strategy: racePlan ? `Plan A: ${racePlan.tyres.join(" -> ")}` : "Use quali and tyre-life data for race planning",
    ersEnable: quali?.enable_ers_display,
    qualiFuel: typeof quali?.fuel_amount_kg === "number" ? `${quali.fuel_amount_kg} kg` : undefined,
    startingTyre: typeof quali?.starting_tyre_temp_c === "number" ? `${quali.starting_tyre_temp_c}C` : undefined,
  };
}

function findSetupById(setups: NormalizedSetup[], id: string): NormalizedSetup | undefined {
  return setups.find((setup) => setup.id === id);
}

function fromNormalized(setup?: NormalizedSetup): SetupValues | undefined {
  if (!setup) {
    return undefined;
  }

  return {
    fw: setup.front_wing,
    rw: setup.rear_wing,
    don: setup.on_throttle_differential,
    doff: setup.off_throttle_differential,
    fs: setup.front_suspension,
    rs: setup.rear_suspension,
    fa: setup.front_anti_roll_bar,
    ra: setup.rear_anti_roll_bar,
    frh: setup.front_ride_height,
    rrh: setup.rear_ride_height,
    bb: setup.brake_bias,
    bp: setup.brake_pressure,
    fl: setup.front_left_pressure,
    fr: setup.front_right_pressure,
    rl: setup.rear_left_pressure,
    rr: setup.rear_right_pressure,
    note: setup.notes || undefined,
  };
}

function fromBrendon(section?: BrendonSetupSection): SetupValues | undefined {
  if (!section) {
    return undefined;
  }

  return {
    fw: section.aerodynamics.front,
    rw: section.aerodynamics.rear,
    don: section.transmission.on,
    doff: Math.round(section.transmission.off),
    fs: section.suspension.front,
    rs: section.suspension.rear,
    fa: section.rollbars.front,
    ra: section.rollbars.rear,
    frh: section.rideHeight.front,
    rrh: section.rideHeight.rear,
    bb: Math.round(section.brakes.bias),
    bp: section.brakes.pressure,
    fl: section.frontTyres.left,
    fr: section.frontTyres.right,
    rl: section.rearTyres.left,
    rr: section.rearTyres.right,
    note: section.notes,
  };
}

function formatLaps(value: number | undefined): string {
  return typeof value === "number" ? `${value} laps` : "N/A";
}
