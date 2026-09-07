/**
 * Typed request/response contracts for the VARUNA backend API.
 *
 * These mirror the Python wire models in `varuna/oily/models.py` one-to-one.
 * Keeping them in one place means endpoint shapes are defined once and reused by
 * every service in `src/api/*` — no ad-hoc `any` shapes scattered through
 * components.
 */
import type { Incident, RiskLevel } from "@/lib/oily/types";

export type DataStatus = "OBSERVED" | "MODELLED" | "ESTIMATED" | "SIMULATED";

/** Fully JSON-serializable value — used for audit/grounding maps so TanStack's
 * server-function serialization guard accepts them (it rejects `unknown`). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type { Incident };

export interface IncidentCreate {
  name: string;
  lat: number;
  lon: number;
  oilType: string;
  persistence: "Persistent" | "Non-persistent";
  volumeTonnes: number;
  spillAreaKm2: number;
  cause: string;
  mlConfidence: number;
  detectionSource: string;
  region?: string;
  notes?: string;
  imageDataUrl?: string | null;
  detectedAt?: string;
  loadEnvironment?: boolean;
}

export interface EnvironmentResponse {
  incidentId: string | null;
  timestamp: string;
  observationTime: string | null;
  wind: { speed: number | null; direction: number | null; unit: string };
  current: { speed: number | null; direction: number | null; unit: string };
  wave: { value: number | null; unit: string };
  temperature: { value: number | null; unit: string };
  source: string;
  dataStatus: DataStatus;
  confidence: number;
  telemetry: {
    currentSpeed: number | null;
    currentDirection: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    waveHeight: number | null;
    temperature: number | null;
    source: string;
    dataStatus: DataStatus;
  };
}

export interface SimulationCreate {
  incidentId: string;
  startTime?: string;
  durationHours?: number;
  timeStepMinutes?: number;
  wind?: { speed: number; direction: number };
  current?: { speed: number; direction: number };
  windage?: number;
  diffusion?: boolean;
  uncertainty?: boolean;
  simulationType?: "drift" | "scenario";
  volumeScale?: number;
}

export interface SimulationCreated {
  simulationId: string;
  status: string;
  modelVersion: string;
}

export interface DenseTrajectoryPoint {
  timestamp: string;
  hours: number;
  latitude: number;
  longitude: number;
  velocity: number;
  direction: number;
  distanceKm: number;
  uncertaintyRadiusKm: number;
  intensity: number;
  status: "afloat" | "beached";
}

export interface TrajectoryWaypoint {
  hours: number;
  latitude: number;
  longitude: number;
  distanceKm: number;
  uncertaintyKm: number;
  beached: boolean;
}

export interface UncertaintyBand {
  enabled: boolean;
  confidence: number;
  radiusKm: number[];
  polygon: number[][];
  label: string;
}

export interface TrajectoryResponse {
  simulationId: string;
  modelVersion: string;
  engine: string;
  points: DenseTrajectoryPoint[];
  waypoints: TrajectoryWaypoint[];
  uncertainty: UncertaintyBand;
  speed: number;
  directionDeg: number;
  uOil: number;
  vOil: number;
  windageCoefficient: number;
  beached: boolean;
  beachedAtHours: number | null;
  diffusionKm2PerS: number;
  notes: string[];
}

export interface ImpactFactor {
  name: string;
  contribution: number;
  value: number | null;
  reason: string;
}

export interface ImpactExposure {
  feature: string;
  name?: string;
  hours: number | null;
  distanceKm: number | null;
  severity: RiskLevel;
}

export interface ImpactResult {
  incidentId: string;
  score: number;
  severity: RiskLevel;
  confidence: number;
  factors: ImpactFactor[];
  reasons: string[];
  exposures: ImpactExposure[];
  inputs: Record<string, JsonValue>;
  modelVersion: string;
  modelBacking: {
    scoreModel: string;
    testMae: number | null;
    testR2: number | null;
    trainingRows: number | null;
    available: boolean;
  };
  dataStatus: DataStatus;
  createdAt: string;
}

export interface SimilarCase {
  incidentId: string;
  name: string;
  location: string;
  region: string;
  date: string;
  oilType: string;
  volumeTonnes: number;
  similarity: number;
  reasons: string[];
}

export interface HistoricalRecord {
  id: string;
  name: string;
  location: string;
  region: string;
  date: string;
  oilType: string;
  persistence: "Persistent" | "Non-persistent";
  volumeTonnes: number;
  cause: string;
  coastalStatus: string;
  impact: RiskLevel;
  lat: number;
  lon: number;
  environmentalImpactScore: number | null;
  distanceToCoastKm: number | null;
  response: string;
  outcome: string;
  source: string;
}

export interface ResponseActionModel {
  rank: number;
  action: string;
  title: string;
  priority: RiskLevel;
  reason: string;
  timeSensitivity: string;
  timing: string;
  resources: string[];
  chain: string[];
}

export interface ResourceRecommendation {
  resource: string;
  type: string;
  recommended: string;
  available: string;
  availability: "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";
}

export interface ResponsePlanModel {
  incidentId: string;
  priority: RiskLevel;
  situation: { label: string; value: string }[];
  actions: ResponseActionModel[];
  resources: ResourceRecommendation[];
  manpower: { roles: { role: string; personnel: number }[]; total: number };
  reasoning: { driver: string }[];
  summary: string;
  modelVersion: string;
  generatedAt: string;
}

export interface ChatResponseModel {
  text: string;
  metrics: { label: string; value: string }[];
  table: { label: string; value: string }[];
  chain: string[];
  grounding: Record<string, JsonValue>;
}

export interface SimulationSummary {
  id: string;
  incidentId: string;
  simulationType: string;
  status: string;
  modelVersion: string;
  startTime: string | null;
  durationHours: number;
  timeStepMinutes: number;
  parameters: Record<string, JsonValue>;
  resultSummary: Record<string, JsonValue>;
  createdAt: string;
  completedAt: string | null;
}

export interface ScenarioResult {
  baseline: ScenarioBrief;
  scenario: ScenarioBrief;
  differences: {
    driftSpeedDelta: number;
    distanceDeltaKm: number;
    coastlineArrival: { baseline: number | null; scenario: number | null };
  };
  modelVersion: string;
}

export interface ScenarioBrief {
  speed: number;
  directionDeg: number;
  distanceKm: number;
  beached: boolean;
  beachedAtHours: number | null;
  waypoints: { hours: number; latitude: number; longitude: number; uncertaintyKm: number }[];
  points: { latitude: number; longitude: number; hours: number }[];
  uncertaintyPolygon: number[][];
}

export interface ResourceRecord {
  resource_id: string;
  type: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  quantity: number;
  unit: string;
  availability: string;
  status: string;
}

export interface MetaResponse {
  modelVersions: Record<string, string>;
  storage: { engine: string; path: string; postgres_ready: boolean };
  history: { source: string; file: string | null; records: number; available: boolean };
  dataStatusLegend: Record<DataStatus, string>;
}
