"use client";

declare global {
  interface Window {
    __BOOTH__?: { apiBase?: string };
  }
}

/**
 * Where the control-plane API lives.
 *
 * Runtime value first (served by /config.js, so a deploy can change it without
 * rebuilding), then the build-time value, then local development.
 */
function resolveApiBase(): string {
  if (typeof window !== "undefined" && window.__BOOTH__?.apiBase) {
    return window.__BOOTH__.apiBase;
  }
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4000";
}

export const API_BASE = resolveApiBase();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("booth_token");
}

export function setToken(token: string | null) {
  if (token) window.localStorage.setItem("booth_token", token);
  else window.localStorage.removeItem("booth_token");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}
