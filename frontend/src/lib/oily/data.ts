import { destination } from "./geo";
import type {
  HistoricalIncident,
  Incident,
  Notification,
  RiskLevel,
} from "./types";

export const APP_NAME = "VARUNA";
export const APP_SUBTITLE = "Oil Spill Intelligence & Emergency Response";

export const DEMO_CREDENTIALS = { email: "operator@oily.demo", password: "Varuna@123" };

export const DISCLAIMERS = {
  general:
    "Varuna provides model-based decision support. Recommendations should be reviewed by trained response personnel and local authorities before operational deployment.",
  manpower:
    "Staffing values are planning estimates and should be validated against actual operational requirements.",
  impact:
    "Environmental impact values represent estimated exposure/severity and are not direct measurements of ecological damage.",
  drift:
    "Drift trajectories are model-based estimates and may change with environmental conditions.",
  similarity:
    "Similarity is a heuristic comparison of spill characteristics and environmental context, not a scientific equivalence.",
};

const HERO: [number, number] = [21.1, 72.91];

export interface SensitiveZone {
  id: string;
  name: string;
  layer:
    | "coastline"
    | "mangrove"
    | "coral"
    | "mpa"
    | "fishing";
  kind: "line" | "polygon";
  path: [number, number][];
}

/** Sensitive environmental features around the hero incident (Gulf of Khambhat / Gujarat coast). */
function ring(bearing: number, distanceKm: number, sizeKm: number): [number, number][] {
  const [lat, lon] = destination(HERO[0], HERO[1], bearing, distanceKm);
  return [
    destination(lat, lon, 0, sizeKm),
    destination(lat, lon, 80, sizeKm * 0.9),
    destination(lat, lon, 150, sizeKm),
    destination(lat, lon, 225, sizeKm * 0.85),
    destination(lat, lon, 300, sizeKm),
  ];
}

export const SENSITIVE_ZONES: SensitiveZone[] = [
  {
    id: "coast-gujarat",
    name: "Gujarat Coastline (Hazira – Bharuch)",
    layer: "coastline",
    kind: "line",
    path: [
      destination(HERO[0], HERO[1], 5, 30),
      destination(HERO[0], HERO[1], 37, 24),
      destination(HERO[0], HERO[1], 70, 27),
      destination(HERO[0], HERO[1], 105, 34),
    ],
  },
  {
    id: "mangrove-narmada",
    name: "Narmada Estuary Mangroves",
    layer: "mangrove",
    kind: "polygon",
    path: ring(33, 24.5, 5),
  },
  {
    id: "fishing-khambhat",
    name: "Khambhat Artisanal Fishing Zone",
    layer: "fishing",
    kind: "polygon",
    path: ring(48, 27, 8),
  },
  {
    id: "mpa-gulf",
    name: "Gulf Marine Protected Area",
    layer: "mpa",
    kind: "polygon",
    path: ring(28, 47, 10),
  },
  {
    id: "coral-piram",
    name: "Piram Bet Coral Community",
    layer: "coral",
    kind: "polygon",
    path: ring(20, 72.5, 7),
  },
];

export const LAYER_META: Record<
  SensitiveZone["layer"],
  { label: string; color: string; weight: number }
> = {
  coastline: { label: "Coastline", color: "#334155", weight: 3 },
  mangrove: { label: "Mangroves", color: "#15803d", weight: 2 },
  coral: { label: "Coral Reefs", color: "#c2410c", weight: 2 },
  mpa: { label: "Marine Protected Areas", color: "#7c3aed", weight: 2 },
  fishing: { label: "Fishing Zones", color: "#0e7490", weight: 2 },
};

export const SEED_INCIDENTS: Incident[] = [
  {
    id: "VARUNA-1042",
    name: "Arabian Sea Crude Oil Spill",
    lat: 21.1,
    lon: 72.91,
    region: "Arabian Sea",
    oilType: "Crude Oil",
    persistence: "Persistent",
    volumeTonnes: 420,
    spillAreaKm2: 12.6,
    cause: "Unknown",
    status: "RESPONDING",
    risk: "HIGH",
    detectedAt: "2026-09-02T12:42:00Z",
    mlConfidence: 0.924,
    detectionSource: "Uploaded Satellite Image",
    notes: "Sheen observed along south-western edge of slick. Vessel traffic in vicinity.",
    telemetry: {
      currentSpeed: 0.4,
      currentDirection: 37,
      windSpeed: 8.2,
      windDirection: 45,
      waveHeight: 1.2,
      temperature: 28,
      source: "Regional ocean model + coastal met station",
    },
  },
  {
    id: "VARUNA-1039",
    name: "Gulf of Mexico Fuel Oil Release",
    lat: 28.42,
    lon: -89.62,
    region: "Gulf of Mexico",
    oilType: "Heavy Fuel Oil",
    persistence: "Persistent",
    volumeTonnes: 180,
    spillAreaKm2: 5.4,
    cause: "Pipeline leak",
    status: "ANALYZING",
    risk: "MEDIUM",
    detectedAt: "2026-09-02T09:15:00Z",
    mlConfidence: 0.871,
    detectionSource: "Sentinel-1 SAR scene",
    telemetry: {
      currentSpeed: 0.28,
      currentDirection: 300,
      windSpeed: 6.1,
      windDirection: 290,
      waveHeight: 0.9,
      temperature: 30,
      source: "Regional ocean model",
    },
  },
  {
    id: "VARUNA-1031",
    name: "North Sea Platform Discharge",
    lat: 57.05,
    lon: 2.15,
    region: "North Sea",
    oilType: "Condensate",
    persistence: "Non-persistent",
    volumeTonnes: 850,
    spillAreaKm2: 21.2,
    cause: "Platform equipment failure",
    status: "CONTAINED",
    risk: "LOW",
    detectedAt: "2026-08-31T05:40:00Z",
    mlConfidence: 0.798,
    detectionSource: "Aerial surveillance imagery",
    telemetry: {
      currentSpeed: 0.22,
      currentDirection: 120,
      windSpeed: 11.4,
      windDirection: 200,
      waveHeight: 2.1,
      temperature: 13,
      source: "Operator telemetry",
    },
  },
  {
    id: "VARUNA-1028",
    name: "Bay of Bengal Bunker Spill",
    lat: 19.2,
    lon: 85.6,
    region: "Bay of Bengal",
    oilType: "Bunker Fuel",
    persistence: "Persistent",
    volumeTonnes: 95,
    spillAreaKm2: 3.1,
    cause: "Vessel collision",
    status: "CONFIRMED",
    risk: "MEDIUM",
    detectedAt: "2026-09-01T18:05:00Z",
    mlConfidence: 0.842,
    detectionSource: "Coastal drone imagery",
    telemetry: {
      currentSpeed: 0.35,
      currentDirection: 260,
      windSpeed: 7.4,
      windDirection: 250,
      waveHeight: 1.5,
      temperature: 29,
      source: "Regional ocean model",
    },
  },
  {
    id: "VARUNA-1024",
    name: "Mediterranean Tanker Discharge",
    lat: 34.9,
    lon: 24.2,
    region: "Mediterranean Sea",
    oilType: "Crude Oil",
    persistence: "Persistent",
    volumeTonnes: 1200,
    spillAreaKm2: 38.7,
    cause: "Tanker grounding",
    status: "RESPONDING",
    risk: "HIGH",
    detectedAt: "2026-08-30T22:10:00Z",
    mlConfidence: 0.955,
    detectionSource: "Sentinel-2 optical scene",
    telemetry: {
      currentSpeed: 0.31,
      currentDirection: 15,
      windSpeed: 9.6,
      windDirection: 20,
      waveHeight: 1.7,
      temperature: 25,
      source: "Copernicus marine service",
    },
  },
];

export const RESPONSE_RESOURCES = [
  { resource: "Containment Boom", available: 12.4, unit: "km", icon: "boom" },
  { resource: "Skimmer Vessels", available: 8, unit: "vessels", icon: "vessel" },
  { resource: "Response Personnel", available: 42, unit: "personnel", icon: "people" },
  { resource: "Monitoring Drones", available: 6, unit: "drones", icon: "drone" },
  { resource: "Wildlife Response Units", available: 5, unit: "units", icon: "wildlife" },
];

export const LIVE_FEED = [
  { time: "12:42", text: "Spill #1042 detected", level: "critical" as const },
  { time: "12:39", text: "Spill #1039 trajectory updated", level: "warning" as const },
  { time: "12:32", text: "Spill #1031 containment confirmed", level: "safe" as const },
  { time: "12:20", text: "Environmental exposure detected near mangrove region", level: "warning" as const },
  { time: "12:04", text: "Telemetry refresh completed — Arabian Sea sector", level: "info" as const },
  { time: "11:48", text: "Spill #1024 response teams mobilised", level: "warning" as const },
];

export const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    level: "critical",
    message: "VARUNA-1042 may reach coastline in approximately 16 hours.",
    time: "12:53",
  },
  { id: "n2", level: "warning", message: "VARUNA-1042 trajectory updated.", time: "12:49" },
  {
    id: "n3",
    level: "warning",
    message: "Environmental exposure detected near mangrove region.",
    time: "12:34",
  },
  { id: "n4", level: "safe", message: "VARUNA-1031 containment confirmed.", time: "12:32" },
];

/* --------------------------------------------------------------------------
 * Historical repository.
 * Landmark cases are curated; the remaining records are generated from a
 * deterministic seed so the repository behaves like an imported dataset
 * (in production this is populated from oil_spill_environmental_master.csv).
 * ------------------------------------------------------------------------ */

const LANDMARKS: HistoricalIncident[] = [
  {
    id: "HIST-EXXON-1989",
    name: "Exxon Valdez",
    location: "Prince William Sound, Alaska",
    region: "North Pacific",
    date: "1989-03-24",
    oilType: "Crude Oil",
    persistence: "Persistent",
    volumeTonnes: 37000,
    cause: "Vessel grounding",
    coastalStatus: "Extensive shoreline oiling",
    impact: "CRITICAL",
    lat: 60.84,
    lon: -146.87,
    response: "Booming, skimming, dispersants, high-pressure shoreline washing",
    outcome: "Long-term shoreline residue; multi-decade monitoring programme",
    source: "Public incident record",
  },
  {
    id: "HIST-DWH-2010",
    name: "Deepwater Horizon",
    location: "Macondo Prospect, Gulf of Mexico",
    region: "Gulf of Mexico",
    date: "2010-04-20",
    oilType: "Light Crude Oil",
    persistence: "Persistent",
    volumeTonnes: 627000,
    cause: "Wellhead blowout",
    coastalStatus: "Multi-state coastal and marsh oiling",
    impact: "CRITICAL",
    lat: 28.74,
    lon: -88.39,
    response: "Subsea dispersant injection, in-situ burning, large-scale booming",
    outcome: "Extended offshore and coastal impact; long-running restoration effort",
    source: "Public incident record",
  },
  {
    id: "HIST-PRESTIGE-2002",
    name: "Prestige",
    location: "Off Galicia, Spain",
    region: "North Atlantic",
    date: "2002-11-13",
    oilType: "Heavy Fuel Oil",
    persistence: "Persistent",
    volumeTonnes: 63000,
    cause: "Hull failure in heavy weather",
    coastalStatus: "Severe coastal oiling, fisheries closure",
    impact: "CRITICAL",
    lat: 42.63,
    lon: -9.87,
    response: "Offshore recovery, extensive shoreline cleanup, fishing bans",
    outcome: "Major fisheries and tourism disruption over multiple seasons",
    source: "Public incident record",
  },
  {
    id: "HIST-MSCELSA-2020",
    name: "MV Wakashio",
    location: "Pointe d'Esny, Mauritius",
    region: "Indian Ocean",
    date: "2020-07-25",
    oilType: "Very Low Sulphur Fuel Oil",
    persistence: "Persistent",
    volumeTonnes: 1000,
    cause: "Vessel grounding on reef",
    coastalStatus: "Lagoon, mangrove and reef exposure",
    impact: "HIGH",
    lat: -20.44,
    lon: 57.74,
    response: "Community booming, mangrove protection, wildlife response",
    outcome: "Mangrove and lagoon damage; ongoing ecological monitoring",
    source: "Public incident record",
  },
  {
    id: "HIST-ENNORE-2017",
    name: "Ennore Oil Spill",
    location: "Ennore, Chennai, India",
    region: "Bay of Bengal",
    date: "2017-01-28",
    oilType: "Heavy Fuel Oil",
    persistence: "Persistent",
    volumeTonnes: 250,
    cause: "Vessel collision",
    coastalStatus: "Beach oiling along urban coastline",
    impact: "MEDIUM",
    lat: 13.24,
    lon: 80.33,
    response: "Manual shoreline recovery, skimmers, community mobilisation",
    outcome: "Shoreline cleanup completed over several weeks",
    source: "Public incident record",
  },
  {
    id: "HIST-MUMBAI-2010",
    name: "MSC Chitra Collision",
    location: "Off Mumbai, India",
    region: "Arabian Sea",
    date: "2010-08-07",
    oilType: "Bunker Fuel",
    persistence: "Persistent",
    volumeTonnes: 800,
    cause: "Vessel collision",
    coastalStatus: "Mangrove and harbour oiling",
    impact: "HIGH",
    lat: 18.9,
    lon: 72.85,
    response: "Booming of creeks, dispersants offshore, mangrove protection",
    outcome: "Mangrove impact along creek systems; port disruption",
    source: "Public incident record",
  },
];

const OILS = [
  ["Crude Oil", "Persistent"],
  ["Heavy Fuel Oil", "Persistent"],
  ["Bunker Fuel", "Persistent"],
  ["Diesel", "Non-persistent"],
  ["Condensate", "Non-persistent"],
  ["Marine Gas Oil", "Non-persistent"],
] as const;

const PLACES: { location: string; region: string; lat: number; lon: number }[] = [
  { location: "Gulf of Khambhat, India", region: "Arabian Sea", lat: 21.3, lon: 72.4 },
  { location: "Off Kochi, India", region: "Arabian Sea", lat: 9.96, lon: 76.0 },
  { location: "Strait of Hormuz", region: "Persian Gulf", lat: 26.6, lon: 56.3 },
  { location: "Singapore Strait", region: "South China Sea", lat: 1.24, lon: 103.8 },
  { location: "Bohai Bay, China", region: "Yellow Sea", lat: 38.5, lon: 119.0 },
  { location: "Niger Delta, Nigeria", region: "Gulf of Guinea", lat: 4.4, lon: 6.1 },
  { location: "Rio de Janeiro coast, Brazil", region: "South Atlantic", lat: -22.9, lon: -43.1 },
  { location: "Gulf of Suez", region: "Red Sea", lat: 28.9, lon: 33.1 },
  { location: "Baltic approaches", region: "Baltic Sea", lat: 55.6, lon: 12.9 },
  { location: "Gulf of Mexico shelf", region: "Gulf of Mexico", lat: 27.9, lon: -91.2 },
  { location: "English Channel", region: "North Atlantic", lat: 50.2, lon: -1.4 },
  { location: "Sea of Japan", region: "North Pacific", lat: 38.2, lon: 133.4 },
  { location: "Gulf of Thailand", region: "South China Sea", lat: 12.6, lon: 100.9 },
  { location: "Bay of Bengal shelf", region: "Bay of Bengal", lat: 17.9, lon: 84.2 },
  { location: "Aegean Sea", region: "Mediterranean Sea", lat: 37.6, lon: 25.4 },
];

const CAUSES = [
  "Vessel collision",
  "Vessel grounding",
  "Pipeline leak",
  "Platform equipment failure",
  "Transfer operation error",
  "Illegal discharge",
  "Storage tank failure",
  "Unknown",
];

const COASTAL = [
  "No shoreline oiling recorded",
  "Light shoreline oiling",
  "Moderate shoreline oiling",
  "Extensive shoreline oiling",
  "Mangrove exposure recorded",
];

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildHistorical(): HistoricalIncident[] {
  const rnd = mulberry(42);
  const rows: HistoricalIncident[] = [...LANDMARKS];
  for (let i = 0; i < 174; i++) {
    const place = PLACES[Math.floor(rnd() * PLACES.length)]!;
    const oil = OILS[Math.floor(rnd() * OILS.length)]!;
    const volume = Math.round(10 + rnd() ** 3 * 24000);
    const year = 1978 + Math.floor(rnd() * 48);
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    const coastal = COASTAL[Math.floor(rnd() * COASTAL.length)]!;
    const impact: RiskLevel =
      volume > 12000
        ? "CRITICAL"
        : volume > 2500
          ? "HIGH"
          : volume > 400
            ? "MEDIUM"
            : "LOW";
    rows.push({
      id: `HIST-${year}-${String(1000 + i)}`,
      name: `${place.region} spill ${year}-${String(month).padStart(2, "0")}`,
      location: place.location,
      region: place.region,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      oilType: oil[0],
      persistence: oil[1],
      volumeTonnes: volume,
      cause: CAUSES[Math.floor(rnd() * CAUSES.length)]!,
      coastalStatus: coastal,
      impact,
      lat: +(place.lat + (rnd() - 0.5) * 2.4).toFixed(3),
      lon: +(place.lon + (rnd() - 0.5) * 2.4).toFixed(3),
      response:
        oil[1] === "Persistent"
          ? "Containment booming and mechanical recovery"
          : "Monitoring with natural attenuation",
      outcome:
        impact === "LOW"
          ? "Dispersed offshore with no recorded shoreline impact"
          : impact === "MEDIUM"
            ? "Localised shoreline cleanup completed"
            : "Sustained response operations and ecological monitoring",
      source: "oil_spill_environmental_master.csv (imported)",
    });
  }
  return rows;
}

export const HISTORICAL_INCIDENTS: HistoricalIncident[] = buildHistorical();

export const ROLES = [
  {
    id: "operator",
    title: "Response Operator",
    description: "Monitor incidents and coordinate emergency response.",
  },
  {
    id: "analyst",
    title: "Environmental Analyst",
    description: "Analyze environmental impact and ecological exposure.",
  },
  {
    id: "incident",
    title: "Incident Analyst",
    description: "Review historical incidents and trajectories.",
  },
  {
    id: "admin",
    title: "Administrator",
    description: "Manage users, incidents and system configuration.",
  },
] as const;
