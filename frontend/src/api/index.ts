/**
 * VARUNA API — the single entry point every component imports from.
 *
 *     import { oily } from "@/api";
 *     const incidents = await oily.incidents.list();
 *     const traj = await oily.simulations.runDrift({ incidentId });
 *
 * Each domain service (incidents, environment, simulations, impact, history,
 * response, ml, meta) owns its own typed request/response contract and its
 * endpoint strings; nothing is duplicated across components.
 */
export * from "./types";
export { OilyApiError } from "./client";
export { incidentsApi } from "./incidents";
export { environmentApi } from "./environment";
export { simulationsApi } from "./simulations";
export { impactApi } from "./impact";
export { historyApi } from "./history";
export { responseApi } from "./response";
export { mlApi } from "./ml";
export { metaApi } from "./meta";

import { incidentsApi } from "./incidents";
import { environmentApi } from "./environment";
import { simulationsApi } from "./simulations";
import { impactApi } from "./impact";
import { historyApi } from "./history";
import { responseApi } from "./response";
import { mlApi } from "./ml";
import { metaApi } from "./meta";

export const oily = {
  incidents: incidentsApi,
  environment: environmentApi,
  simulations: simulationsApi,
  impact: impactApi,
  history: historyApi,
  response: responseApi,
  ml: mlApi,
  meta: metaApi,
};
