import { createServerFn } from "@tanstack/react-start";
import { apiGet } from "./client";
import type { MetaResponse, ResourceRecord } from "./types";

/** Platform metadata: model versions, storage backend, dataset provenance, and
 * the data-status legend — surfaced in the UI so every number is attributable. */

const metaFn = createServerFn({ method: "GET" }).handler(async () =>
  apiGet<MetaResponse>("/api/meta"),
);

const resourcesFn = createServerFn({ method: "GET" }).handler(async () =>
  apiGet<ResourceRecord[]>("/api/resources"),
);

export const metaApi = {
  get: () => metaFn(),
  resources: () => resourcesFn(),
};
