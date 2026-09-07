import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPost } from "./client";
import type { EnvironmentResponse } from "./types";

/** Environment service — the single provider of wind/current/wave/temp with an
 * explicit data-provenance label on every field. */

const getEnvironmentFn = createServerFn({ method: "GET" })
  .inputValidator((data: { incidentId: string }) => data)
  .handler(async ({ data }) => apiGet<EnvironmentResponse>(`/api/environment/${data.incidentId}`));

/** Raw live telemetry at a coordinate (used when logging a brand-new incident). */
const liveTelemetryFn = createServerFn({ method: "POST" })
  .inputValidator((data: { latitude: number; longitude: number }) => data)
  .handler(async ({ data }) =>
    apiPost<EnvironmentResponse["telemetry"]>("/api/environment/telemetry", data),
  );

export const environmentApi = {
  forIncident: (incidentId: string) => getEnvironmentFn({ data: { incidentId } }),
  live: (latitude: number, longitude: number) =>
    liveTelemetryFn({ data: { latitude, longitude } }),
};
