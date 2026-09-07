/**
 * Base HTTP client for the VARUNA backend.
 *
 * These helpers run **server-side only** (inside TanStack Start server
 * functions) — they hold the single source of the backend base URL and the
 * shared error/timeout handling, so no component ever hard-codes an endpoint
 * string or talks to the Python service directly. The browser calls the typed
 * server functions in the sibling modules; those call these helpers.
 */

/** Backend base URL — server env only, never shipped to the browser bundle. */
export const OILY_API_URL =
  process.env["OILY_API_URL"] ?? process.env["VARUNA_API_URL"] ?? "http://127.0.0.1:8000";

const DEFAULT_TIMEOUT_MS = 30_000;

export class OilyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OilyApiError";
  }
}

function unreachable(path: string, cause: unknown): OilyApiError {
  return new OilyApiError(
    `Could not reach the VARUNA backend at ${OILY_API_URL}${path}. Start it with ` +
      `".venv311\\Scripts\\python.exe scripts\\run_api.py" from "model_for_spill_detection/all model".`,
    undefined,
    cause,
  );
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OILY_API_URL}${path}`, { ...init, signal: controller.signal });
  } catch (cause) {
    throw unreachable(path, cause);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new OilyApiError(`VARUNA backend ${res.status} on ${path}: ${detail}`, res.status);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
