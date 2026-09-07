import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPatch, apiPost } from "./client";
import type { Incident, IncidentCreate, SimilarCase } from "./types";

/** Incident service — CRUD + similarity, all backed by the database. */

const listIncidentsFn = createServerFn({ method: "GET" }).handler(
  async () => apiGet<Incident[]>("/api/incidents"),
);

const getIncidentFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => apiGet<Incident>(`/api/incidents/${data.id}`));

const createIncidentFn = createServerFn({ method: "POST" })
  .inputValidator((data: IncidentCreate) => data)
  .handler(async ({ data }) => apiPost<Incident>("/api/incidents", data));

const updateIncidentFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patch: Partial<Incident> }) => data)
  .handler(async ({ data }) => apiPatch<Incident>(`/api/incidents/${data.id}`, data.patch));

const similarFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string; limit?: number | undefined }) => data)
  .handler(async ({ data }) =>
    apiGet<SimilarCase[]>(`/api/incidents/${data.id}/similar?limit=${data.limit ?? 5}`),
  );

export const incidentsApi = {
  list: () => listIncidentsFn(),
  get: (id: string) => getIncidentFn({ data: { id } }),
  create: (data: IncidentCreate) => createIncidentFn({ data }),
  update: (id: string, patch: Partial<Incident>) => updateIncidentFn({ data: { id, patch } }),
  similar: (id: string, limit?: number) => similarFn({ data: { id, limit } }),
};
