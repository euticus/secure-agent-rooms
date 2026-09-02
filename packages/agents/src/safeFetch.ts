import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-safe URL fetcher (spec §36).
 *
 * - HTTPS only (http allowed only when explicitly opted in for local dev)
 * - resolves DNS and rejects private / loopback / link-local / metadata ranges
 * - follows redirects manually, re-validating every hop
 * - restricts ports, response size, and time
 */

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedContentTypes?: string[];
  allowHttpLoopbackForDev?: boolean;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}

const ALLOWED_PORTS = new Set([443, 8443, 80]);

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return false;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

async function assertUrlSafe(url: URL, opts: SafeFetchOptions): Promise<void> {
  const devLoopback =
    opts.allowHttpLoopbackForDev === true &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !(url.protocol === "http:" && devLoopback)) {
    throw new SsrfError(`protocol ${url.protocol} not allowed`);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port) && !devLoopback) {
    throw new SsrfError(`port ${port} not allowed`);
  }
  if (devLoopback) return;

  const host = url.hostname;
  const candidates: string[] = [];
  if (isIP(host)) {
    candidates.push(host);
  } else {
    const results = await lookup(host, { all: true }).catch(() => []);
    if (results.length === 0) throw new SsrfError(`cannot resolve host ${host}`);
    for (const r of results) candidates.push(r.address);
  }
  for (const ip of candidates) {
    if (isPrivateAddress(ip)) {
      throw new SsrfError(`host ${host} resolves to private/blocked address`);
    }
  }
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<{
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
}> {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 3;

  let url = new URL(rawUrl);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertUrlSafe(url, opts);
    const controller = new AbortController();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SsrfError("fetch timeout");
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new SsrfError("redirect without location");
        url = new URL(loc, url); // next loop iteration re-validates
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (opts.allowedContentTypes && !opts.allowedContentTypes.some((t) => contentType.includes(t))) {
        throw new SsrfError(`content-type ${contentType} not allowed`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new SsrfError("response too large");
      return { status: res.status, contentType, body: buf.toString("utf8"), finalUrl: url.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SsrfError("too many redirects");
}
