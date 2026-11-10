import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default 30s cuts off large list responses (e.g. all POs) on slow backend→DB links.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:5001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
