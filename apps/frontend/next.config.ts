import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

// next.config.ts compiles to ESM (no __dirname); Next always runs the config
// with cwd at the app root, so package.json resolves from there.
const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    // Baked at build time so the UI can show which release is running.
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async rewrites() {
    // BACKEND_INTERNAL_URL is server-only (not NEXT_PUBLIC_) — used only by this rewrite.
    // Keep NEXT_PUBLIC_API_URL empty so the client always calls /api/v1 (same-origin),
    // which keeps the refresh_token cookie first-party to the frontend host and visible
    // to the edge proxy auth guard (src/proxy.ts).
    const apiUrl =
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:4000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
