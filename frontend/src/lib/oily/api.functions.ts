import { createServerFn } from "@tanstack/react-start";
import { HISTORICAL_INCIDENTS } from "./data";
import {
  answerQuestion,
  buildIntelligence,
  calculateDrift,
  calculateExposures,
  calculateImpact,
  findSimilarIncidents,
  generateResponsePlan,
} from "./engine";
import type { Incident } from "./types";

/**
 * Service boundary for Varuna.
 *
 * Every intelligence product (classification, drift, impact, response, chat,
 * simulation) is produced behind a server function so the mock engines can be
 * swapped for the real ML model, ocean-current APIs and backend database
 * without touching any UI component.
 */

/**
 * POST /api/ml/classify — real spill classifier.
 *
 * Forwards the uploaded SAR image to the Varuna inference service
 * (model_for_spill_detection/all model — a separate Python/FastAPI process;
 * see MODEL_INTEGRATION_PLAN.md) and maps its response onto MLPrediction.
 * VARUNA_API_URL defaults to the service's local dev address.
 */
const VARUNA_API_URL = process.env["VARUNA_API_URL"] ?? "http://127.0.0.1:8000";

export const classifyImage = createServerFn({ method: "POST" })
  .inputValidator((data: { fileName: string; fileDataBase64: string }) => data)
  .handler(async ({ data }) => {
    const binary = Buffer.from(data.fileDataBase64, "base64");
    const form = new FormData();
    form.append("file", new Blob([binary]), data.fileName);

    let response: Response;
    try {
      response = await fetch(`${VARUNA_API_URL}/detect`, { method: "POST", body: form });
    } catch (cause) {
      throw new Error(
        `Could not reach the Varuna detection service at ${VARUNA_API_URL}. Start it with ` +
          `".venv311\\Scripts\\python.exe scripts\\run_api.py" from model_for_spill_detection/all model.`,
        { cause },
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Varuna detection service returned ${response.status}: ${detail}`);
    }

    const result = (await response.json()) as {
      model: string;
      classification: "oil_spill" | "background";
      confidence: number;
      spillProbability: number;
      backgroundProbability: number;
      segmentationAvailable: boolean;
      estimatedAreaKm2: number;
      boxes: { x: number; y: number; w: number; h: number; score: number }[];
      geometryAreaM2?: number | null;
      geometryElongation?: number | null;
      maskPngBase64?: string | null;
    };
    return result;
  });

/**
 * POST /api/impact/predict — real environmental-impact model.
 *
 * Calls the Varuna service's /impact/predict endpoint: a gradient-boosting
 * regressor trained on 1,116 real, complete-feature NOAA historical spill
 * records (oil_spill_environmental_master_v2.csv — see
 * "enviromental impact/oil_spill_dataset_description.pdf" and
 * MODEL_INTEGRATION_PLAN.md). Replaces the frontend's hand-written
 * calculateImpact() heuristic wherever it's used on the Impact page.
 */
export interface RealImpactPrediction {
  score: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  distanceToCoastKm: number;
  isOceanPoint: boolean;
  components: { label: string; value: number; note: string }[];
  modelTestMae: number;
  modelTestR2: number;
  modelTrainingRows: number;
}

export const predictImpactFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { latitude: number; longitude: number; oilPersistence: string; volumeTonnes: number }) => data,
  )
  .handler(async ({ data }): Promise<RealImpactPrediction> => {
    let response: Response;
    try {
      response = await fetch(`${VARUNA_API_URL}/impact/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (cause) {
      throw new Error(
        `Could not reach the Varuna impact model at ${VARUNA_API_URL}. Start it with ` +
          `".venv311\\Scripts\\python.exe scripts\\run_api.py" from model_for_spill_detection/all model.`,
        { cause },
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Varuna impact model returned ${response.status}: ${detail}`);
    }
    return (await response.json()) as RealImpactPrediction;
  });

/**
 * POST /api/environment/nearby — real named coastal/ecological features.
 *
 * Calls the Varuna service's /environment/nearby endpoint, which queries the
 * OpenStreetMap Overpass API for the nearest fishing harbour, protected-area/
 * wildlife sanctuary, mangrove wetland and coral reef around a coordinate.
 */
export interface NearbyFeature {
  category: "fishing_harbour" | "protected_area" | "mangrove" | "coral_reef";
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  bearing: string;
}

export interface NearbyResponse {
  distanceToCoastKm: number;
  isOceanPoint: boolean;
  features: NearbyFeature[];
  source: string;
}

export const nearbyFeaturesFn = createServerFn({ method: "POST" })
  .inputValidator((data: { latitude: number; longitude: number; radiusKm?: number | undefined }) => data)
  .handler(async ({ data }): Promise<NearbyResponse> => {
    let response: Response;
    try {
      response = await fetch(`${VARUNA_API_URL}/environment/nearby`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, radiusKm: data.radiusKm ?? 90 }),
      });
    } catch (cause) {
      throw new Error(
        `Could not reach the Varuna service at ${VARUNA_API_URL} for nearby features.`,
        { cause },
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Nearby-features lookup returned ${response.status}: ${detail}`);
    }
    return (await response.json()) as NearbyResponse;
  });

/**
 * POST /api/telemetry/live — real environmental conditions at a coordinate.
 *
 * Fetches actual current wind (Open-Meteo Forecast API) and ocean
 * current/wave data (Open-Meteo Marine API) — both free, no API key —
 * replacing the previously hardcoded telemetry values logged with new
 * incidents. Units are converted from Open-Meteo's km/h to the app's m/s
 * convention (see lib/oily/types.ts Telemetry).
 */
export const fetchLiveTelemetryFn = createServerFn({ method: "POST" })
  .inputValidator((data: { latitude: number; longitude: number }) => data)
  .handler(async ({ data }) => {
    const kmhToMs = (v: number) => v / 3.6;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${data.latitude}&longitude=${data.longitude}&current=wave_height,ocean_current_velocity,ocean_current_direction`;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${data.latitude}&longitude=${data.longitude}&current=wind_speed_10m,wind_direction_10m,temperature_2m`;

    try {
      const [marineRes, weatherRes] = await Promise.all([fetch(marineUrl), fetch(weatherUrl)]);
      if (!marineRes.ok || !weatherRes.ok) {
        throw new Error(`marine=${marineRes.status} weather=${weatherRes.status}`);
      }
      const marine = (await marineRes.json()) as {
        current: { wave_height: number; ocean_current_velocity: number; ocean_current_direction: number };
      };
      const weather = (await weatherRes.json()) as {
        current: { wind_speed_10m: number; wind_direction_10m: number; temperature_2m: number };
      };
      return {
        currentSpeed: +kmhToMs(marine.current.ocean_current_velocity).toFixed(2),
        currentDirection: Math.round(marine.current.ocean_current_direction),
        windSpeed: +kmhToMs(weather.current.wind_speed_10m).toFixed(2),
        windDirection: Math.round(weather.current.wind_direction_10m),
        waveHeight: marine.current.wave_height,
        temperature: weather.current.temperature_2m,
        source: "Open-Meteo Marine + Forecast API (live)",
      };
    } catch (cause) {
      throw new Error(
        "Could not reach Open-Meteo for live environmental data. Check network access.",
        { cause },
      );
    }
  });

/**
 * POST /api/drift/forecast — real land-aware physics drift.
 *
 * Calls the Varuna service's /drift/forecast: the same V_oil = V_current +
 * C_w·V_wind physics as the client engine, but walked forward and stopped at
 * first land contact (global-land-mask coastline) so the slick beaches on the
 * shore instead of drifting inland.
 */
export interface LandAwareDriftPoint {
  hours: number;
  lat: number;
  lon: number;
  distanceKm: number;
  uncertaintyKm: number;
  beached: boolean;
}

export interface LandAwareDrift {
  uOil: number;
  vOil: number;
  speed: number;
  directionDeg: number;
  windageCoefficient: number;
  points: LandAwareDriftPoint[];
  beached: boolean;
  beachedAtHours: number | null;
  source: string;
}

export const driftForecastFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      latitude: number;
      longitude: number;
      currentSpeed: number;
      currentDirection: number;
      windSpeed: number;
      windDirection: number;
      spillAreaKm2: number;
    }) => data,
  )
  .handler(async ({ data }): Promise<LandAwareDrift> => {
    let response: Response;
    try {
      response = await fetch(`${VARUNA_API_URL}/drift/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (cause) {
      throw new Error(`Could not reach the Varuna drift service at ${VARUNA_API_URL}.`, { cause });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Drift forecast returned ${response.status}: ${detail}`);
    }
    return (await response.json()) as LandAwareDrift;
  });

/** POST /api/drift/calculate */
export const calculateDriftFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      lat: number;
      lon: number;
      currentSpeed: number;
      currentDirection: number;
      windSpeed: number;
      windDirection: number;
      windage?: number | undefined;
      spillAreaKm2: number;
    }) => data,
  )
  .handler(async ({ data }) => calculateDrift(data));

/** POST /api/impact/calculate */
export const calculateImpactFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incident: Incident }) => data)
  .handler(async ({ data }) => {
    const { forecast } = buildIntelligence(data.incident);
    return {
      forecast,
      impact: calculateImpact(data.incident, forecast, calculateExposures(data.incident, forecast)),
    };
  });

/** POST /api/response/generate */
export const generateResponseFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incident: Incident }) => data)
  .handler(async ({ data }) => {
    const { forecast, impact } = buildIntelligence(data.incident);
    return { forecast, impact, plan: generateResponsePlan(data.incident, forecast, impact) };
  });

/** POST /api/response/chat */
export const responseChatFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incident: Incident; question: string }) => data)
  .handler(async ({ data }) => {
    const { forecast, impact, plan } = buildIntelligence(data.incident);
    return answerQuestion(data.question, { incident: data.incident, forecast, impact, plan });
  });

/** POST /api/simulator/run */
export const runSimulationFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      incident: Incident;
      scenarios: {
        label: string;
        windScale: number;
        windDirectionDelta: number;
        currentScale: number;
        currentDirectionDelta: number;
        volumeScale: number;
      }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    return data.scenarios.map((s) => {
      const t = data.incident.telemetry;
      const incident: Incident = {
        ...data.incident,
        volumeTonnes: Math.round(data.incident.volumeTonnes * s.volumeScale),
        spillAreaKm2: +(data.incident.spillAreaKm2 * s.volumeScale).toFixed(1),
      };
      const forecast = calculateDrift({
        lat: incident.lat,
        lon: incident.lon,
        currentSpeed: (t.currentSpeed ?? 0) * s.currentScale,
        currentDirection: (t.currentDirection ?? 0) + s.currentDirectionDelta,
        windSpeed: (t.windSpeed ?? 0) * s.windScale,
        windDirection: (t.windDirection ?? 0) + s.windDirectionDelta,
        spillAreaKm2: incident.spillAreaKm2,
      });
      const impact = calculateImpact(incident, forecast);
      return { label: s.label, forecast, impact };
    });
  });

/** GET /api/history/similar/:incidentId */
export const similarIncidentsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incident: Incident; limit?: number | undefined }) => data)
  .handler(async ({ data }) => findSimilarIncidents(data.incident, data.limit ?? 5));

/** GET /api/history */
export const listHistoryFn = createServerFn({ method: "GET" }).handler(
  async () => HISTORICAL_INCIDENTS,
);
