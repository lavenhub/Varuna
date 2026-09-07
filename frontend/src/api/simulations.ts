import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPost } from "./client";
import type {
  ScenarioResult,
  SimulationCreate,
  SimulationCreated,
  SimulationSummary,
  TrajectoryResponse,
} from "./types";

/** Simulation service — create a stored simulation, poll its status, fetch its
 * trajectory, and run What-If scenarios through the same engine. */

const createSimulationFn = createServerFn({ method: "POST" })
  .inputValidator((data: SimulationCreate) => data)
  .handler(async ({ data }) => apiPost<SimulationCreated>("/api/simulations", data));

const getSimulationFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => apiGet<SimulationSummary>(`/api/simulations/${data.id}`));

const getTrajectoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) =>
    apiGet<TrajectoryResponse>(`/api/simulations/${data.id}/trajectory`),
  );

const scenarioFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      incidentId: string;
      durationHours?: number;
      scenario: {
        windScale?: number;
        windDirectionDelta?: number;
        currentScale?: number;
        currentDirectionDelta?: number;
        volumeScale?: number;
        windage?: number;
      };
    }) => data,
  )
  .handler(async ({ data }) => apiPost<ScenarioResult>("/api/simulations/scenario", data));

export const simulationsApi = {
  create: (data: SimulationCreate) => createSimulationFn({ data }),
  get: (id: string) => getSimulationFn({ data: { id } }),
  trajectory: (id: string) => getTrajectoryFn({ data: { id } }),
  scenario: (input: Parameters<typeof scenarioFn>[0]["data"]) => scenarioFn({ data: input }),
  /** Convenience: create a drift simulation and immediately return its trajectory. */
  async runDrift(data: SimulationCreate): Promise<TrajectoryResponse> {
    const created = await createSimulationFn({ data });
    return getTrajectoryFn({ data: { id: created.simulationId } });
  },
};
