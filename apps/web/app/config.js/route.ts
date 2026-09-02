/**
 * Runtime configuration for the browser.
 *
 * `NEXT_PUBLIC_*` values are compiled into the client bundle, which means
 * changing the API URL would require rebuilding the image — a genuine trap on
 * any host where you set environment variables after the first deploy. Serving
 * the value from a route handler instead makes it a restart-time change, and
 * keeps the marketing and docs pages statically rendered.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const apiBase = (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "http://localhost:4000"
  ).replace(/\/$/, "");

  // JSON.stringify escapes quotes and closing tags safely for a script body.
  const body = `window.__BOOTH__=${JSON.stringify({ apiBase })};`;

  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Never cache: the whole point is that a restart can change it.
      "cache-control": "no-store, max-age=0",
    },
  });
}
