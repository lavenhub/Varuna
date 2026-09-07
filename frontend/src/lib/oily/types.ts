export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentStatus =
  | "DETECTED"
  | "CLASSIFIED"
  | "CONFIRMED"
  | "ANALYZING"
  | "RESPONDING"
  | "CONTAINED"
  | "CLOSED";

export type DataQuality = "OBSERVED" | "MODELLED" | "ESTIMATED" | "SIMULATED";

export interface Telemetry {
  currentSpeed: number | null; // m/s
  currentDirection: number | null; // degrees, oceanographic "toward"
  windSpeed: number | null; // m/s
  windDirection: number | null; // degrees
  waveHeight: number | null; // m
  temperature: number | null; // celsius
  source: string;
  dataStatus?: DataQuality; // provenance label when sourced from the environment service
}

export interface Incident {
  id: string; // VARUNA-1042
  name: string;
  lat: number;
  lon: number;
  region: string;
  oilType: string;
  persistence: "Persistent" | "Non-persistent";
  volumeTonnes: number;
  spillAreaKm2: number;
  cause: string;
  status: IncidentStatus;
  risk: RiskLevel;
  detectedAt: string; // ISO
  mlConfidence: number; // 0..1
  detectionSource: string;
  notes?: string | undefined;
  imageDataUrl?: string | null | undefined;
  telemetry: Telemetry;
}

export interface MLPrediction {
  classification: "oil_spill" | "background";
  confidence: number;
  spillProbability: number;
  backgroundProbability: number;
  segmentationAvailable: boolean;
  model: string;
  estimatedAreaKm2: number;
  boxes: { x: number; y: number; w: number; h: number; score: number }[];
  /** Slick polygon area in m², from the real segmenter's connected-component geometry. */
  geometryAreaM2?: number | null | undefined;
  /** Major/minor axis ratio of the detected slick polygon. */
  geometryElongation?: number | null | undefined;
  /** Base64-encoded PNG of the full binary segmentation mask, same size as the analyzed frame. */
  maskPngBase64?: string | null | undefined;
  /**
   * Base64-encoded PNG of the analyzed VV band, contrast-stretched to a normal
   * viewable grayscale image. Browsers can't render raw GeoTIFF/SAR uploads
   * inline (e.g. multi-band .tif), so this is what the UI displays instead of
   * the original file — works regardless of the uploaded format.
   */
  sourcePreviewPngBase64?: string | null | undefined;
  /**
   * Base64-encoded JPEG: the same viewable scene as sourcePreviewPngBase64,
   * with the real detected region (not an approximate box) baked in as a
   * translucent red highlight + outline. Preferred over sourcePreviewPngBase64
   * for display whenever present — it shows exactly what the model found.
   */
  annotatedJpegBase64?: string | null | undefined;
}

export interface DriftPoint {
  hours: number;
  lat: number;
  lon: number;
  uncertaintyKm: number;
  distanceKm: number;
}

export interface DriftForecast {
  uOil: number;
  vOil: number;
  speed: number;
  directionDeg: number;
  windageCoefficient: number;
  points: DriftPoint[];
}

export interface ExposureEstimate {
  feature: string;
  hours: number | null;
  distanceKm: number | null;
  severity: RiskLevel;
}

export interface ImpactAssessment {
  score: number;
  severity: RiskLevel;
  confidence: number;
  components: { label: string; value: number; note: string }[];
  reasoning: { driver: string; effect: string }[];
  exposures: ExposureEstimate[];
}

export interface ResponseAction {
  rank: number;
  title: string;
  priority: RiskLevel;
  timing: string;
  reason: string;
  action: string;
  chain: string[];
}

export interface ManpowerEstimate {
  roles: { role: string; personnel: number }[];
  total: number;
}

export interface ResourceRecommendation {
  resource: string;
  recommended: string;
  available: string;
}

export interface ResponsePlan {
  incidentId: string;
  priority: RiskLevel;
  situation: { label: string; value: string }[];
  actions: ResponseAction[];
  manpower: ManpowerEstimate;
  resources: ResourceRecommendation[];
  summary: string;
}

export interface HistoricalIncident {
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
  response: string;
  outcome: string;
  source: string;
}

export interface SimilarMatch {
  historical: HistoricalIncident;
  similarity: number;
  reasons: string[];
}

export interface Notification {
  id: string;
  level: "critical" | "warning" | "info" | "safe";
  message: string;
  time: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  metrics?: { label: string; value: string }[] | undefined;
  chain?: string[] | undefined;
  table?: { label: string; value: string }[] | undefined;
}
