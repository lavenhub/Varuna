import {
  calculateDriftFn,
  calculateImpactFn,
  driftForecastFn,
  fetchLiveTelemetryFn,
  generateResponseFn,
  listHistoryFn,
  nearbyFeaturesFn,
  predictImpactFn,
  responseChatFn,
  runSimulationFn,
  similarIncidentsFn,
} from "@/lib/oily/api.functions";
import type { Incident } from "@/lib/oily/types";

export type {
  RealImpactPrediction,
  NearbyResponse,
  NearbyFeature,
  LandAwareDrift,
  LandAwareDriftPoint,
} from "@/lib/oily/api.functions";

/** Frontend service layer — one place to repoint at the production backend. */
export const oilyApi = {
  drift: (input: Parameters<typeof calculateDriftFn>[0]["data"]) =>
    calculateDriftFn({ data: input }),
  impact: (incident: Incident) => calculateImpactFn({ data: { incident } }),
  /** Real, NOAA-data-trained impact model — see api.functions.ts predictImpactFn. */
  predictImpact: (incident: Incident) =>
    predictImpactFn({
      data: {
        latitude: incident.lat,
        longitude: incident.lon,
        oilPersistence: incident.persistence,
        volumeTonnes: incident.volumeTonnes,
      },
    }),
  /** Real live wind/current/wave conditions at a coordinate (Open-Meteo). */
  liveTelemetry: (latitude: number, longitude: number) =>
    fetchLiveTelemetryFn({ data: { latitude, longitude } }),
  /** Real nearest coastal/ecological features (OpenStreetMap Overpass). */
  nearby: (latitude: number, longitude: number, radiusKm?: number) =>
    nearbyFeaturesFn({ data: { latitude, longitude, radiusKm } }),
  /** Land-aware physics drift forecast (beaches at the coast). */
  driftForecast: (input: Parameters<typeof driftForecastFn>[0]["data"]) =>
    driftForecastFn({ data: input }),
  response: (incident: Incident) => generateResponseFn({ data: { incident } }),
  chat: (incident: Incident, question: string) =>
    responseChatFn({ data: { incident, question } }),
  simulate: (
    incident: Incident,
    scenarios: Parameters<typeof runSimulationFn>[0]["data"]["scenarios"],
  ) => runSimulationFn({ data: { incident, scenarios } }),
  similar: (incident: Incident, limit?: number) =>
    similarIncidentsFn({ data: { incident, limit } }),
  history: () => listHistoryFn(),
};
