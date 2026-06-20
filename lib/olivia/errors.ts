// Typed errors for the Olivia external API (guide §5).

export type OliviaErrorCode =
  | "unauthorized" // 401
  | "forbidden_scope" // 403
  | "client_not_found" // 404
  | "invalid_date_range" // 400
  | "invalid_timezone" // 400
  | "date_range_too_large" // 400
  | "internal_error" // 500
  | "rate_limited" // 429
  | "network_error" // fetch failed
  | "unknown";

export class OliviaError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: OliviaErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "OliviaError";
  }
}

/** Fallback mapping from HTTP status to a machine code when the body omits one. */
export function statusToCode(status: number): OliviaErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden_scope";
    case 404:
      return "client_not_found";
    case 400:
      return "invalid_date_range";
    case 429:
      return "rate_limited";
    case 500:
      return "internal_error";
    default:
      return "unknown";
  }
}
