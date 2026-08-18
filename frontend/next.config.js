/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained standalone server bundle for the Docker image.
  output: "standalone",
  // NOTE: /api proxying is handled by src/middleware.ts so the backend URL can
  // be configured at runtime via BACKEND_URL (Next.js bakes `rewrites()` at
  // build time, which would prevent runtime configuration).
};

module.exports = nextConfig;
