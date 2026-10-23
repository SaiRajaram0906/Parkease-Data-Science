import { logger } from "./logger";

/**
 * Client for the ParkEase Data Science service (Python / FastAPI).
 *
 * The service owns the historical dataset and the trained models. This API
 * server owns the live data. Routes in routes/datascience.ts combine the two.
 */
const ML_SERVICE_URL = (process.env["ML_SERVICE_URL"] ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env["ML_SERVICE_TIMEOUT_MS"] ?? 15000);

export class MlServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${ML_SERVICE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ err, path }, "Data Science service is unreachable");
    throw new MlServiceError(
      503,
      "The Data Science service is not running.",
      "Start it from the project root with: python -m uvicorn ml.service.app:app --port 8000",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = `Data Science service returned ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
      else if (payload.detail) detail = JSON.stringify(payload.detail);
    } catch {
      // keep the generic message
    }
    // 503 from the service means "models or data not ready yet".
    throw new MlServiceError(response.status === 503 ? 503 : response.status === 422 ? 400 : 502, detail);
  }
  return (await response.json()) as T;
}

export const mlGet = <T = Record<string, unknown>>(path: string) => request<T>("GET", path);
export const mlPost = <T = Record<string, unknown>>(path: string, body: unknown) =>
  request<T>("POST", path, body);
