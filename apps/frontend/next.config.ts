import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // BACKEND_INTERNAL_URL is server-only (not NEXT_PUBLIC_) — used only by this rewrite.
    // Keep NEXT_PUBLIC_API_URL empty so the client always calls /api/v1 (same-origin),
    // which keeps the refresh_token cookie first-party to the frontend host and visible
    // to the edge middleware auth guard.
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
