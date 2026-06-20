import "server-only";
import { OliviaError, statusToCode, type OliviaErrorCode } from "./errors";

// Low-level Olivia HTTP client. SERVER ONLY — sets the agency-scoped x-api-key header,
// which must never reach the browser. Two base trees (guide §3):
//   discovery → /api/v1/external
//   analytics → /api/external/v1
const BASE = process.env.OLIVIA_API_BASE ?? "https://www.lunarolivia.com";

export type QueryValue = string | number | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface OliviaFetchOptions {
  params?: QueryParams;
  /** Defaults to GET. POST is used only for the (future) briefing action endpoint. */
  method?: "GET" | "POST";
  /** JSON request body for POST. */
  body?: unknown;
  /** Max 429 retries (honoring Retry-After). Default 2. */
  maxRetries?: number;
  signal?: AbortSignal;
  /** Next.js Data Cache hints (Phase 5). When omitted, the request is `no-store`. */
  next?: { revalidate?: number | false; tags?: string[] };
}

function buildQuery(params: QueryParams = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function oliviaFetch<T>(
  path: string,
  opts: OliviaFetchOptions = {},
): Promise<T> {
  const key = process.env.OLIVIA_API_KEY;
  if (!key) {
    throw new OliviaError(500, "internal_error", "OLIVIA_API_KEY is not configured");
  }

  const url = `${BASE}${path}${buildQuery(opts.params)}`;
  const maxRetries = opts.maxRetries ?? 2;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "x-api-key": key,
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        // server-to-server; no credentials/CORS
        ...(opts.next ? { next: opts.next } : { cache: "no-store" }),
      });
    } catch (e) {
      throw new OliviaError(
        0,
        "network_error",
        `Network error reaching Olivia: ${(e as Error).message}`,
      );
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "5") || 5;
      if (attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 400);
        await sleep(Math.min(retryAfter, 30) * 1000 + jitter);
        continue;
      }
      throw new OliviaError(429, "rate_limited", "Olivia rate limit exceeded", retryAfter);
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: OliviaErrorCode;
      };
      const code = body.code ?? statusToCode(res.status);
      throw new OliviaError(res.status, code, body.error ?? res.statusText);
    }

    return (await res.json()) as T;
  }
}
