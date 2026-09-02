/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Standalone output keeps the production image small (see Dockerfile).
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
