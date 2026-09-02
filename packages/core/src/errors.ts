export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "VALIDATION"
  | "CONFLICT"
  | "STATE"
  | "BUDGET_EXCEEDED";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(what: string): AppError {
  // Cross-tenant probes get the same 404 as truly missing resources —
  // existence itself is tenant-scoped information.
  return new AppError("NOT_FOUND", `${what} not found`);
}

export function forbidden(message = "not authorized"): AppError {
  return new AppError("FORBIDDEN", message);
}
