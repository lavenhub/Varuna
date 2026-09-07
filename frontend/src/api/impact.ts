import { createServerFn } from "@tanstack/react-start";
import { apiPost } from "./client";
import type { ImpactResult } from "./types";

/** Impact service — model-backed score + transparent factor decomposition. */

const calculateImpactFn = createServerFn({ method: "POST" })
  .inputValidator((data: { incidentId: string; includeNearby?: boolean }) => data)
  .handler(async ({ data }) => apiPost<ImpactResult>("/api/impact/calculate", data));

export const impactApi = {
  calculate: (incidentId: string, includeNearby = false) =>
    calculateImpactFn({ data: { incidentId, includeNearby } }),
};
