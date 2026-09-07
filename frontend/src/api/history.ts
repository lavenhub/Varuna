import { createServerFn } from "@tanstack/react-start";
import { apiGet } from "./client";
import type { HistoricalRecord } from "./types";

/** Historical intelligence — served from the real NOAA incident dataset. */

const listHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: { limit?: number | undefined }) => data)
  .handler(async ({ data }) =>
    apiGet<HistoricalRecord[]>(`/api/incidents/history?limit=${data.limit ?? 200}`),
  );

const getHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => apiGet<HistoricalRecord>(`/api/incidents/history/${data.id}`));

export const historyApi = {
  list: (limit?: number) => listHistoryFn({ data: { limit } }),
  get: (id: string) => getHistoryFn({ data: { id } }),
};
