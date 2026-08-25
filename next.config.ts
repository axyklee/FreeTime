import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Course schedules are a few KB; keep uploads tight.
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: {
    // Next's default image optimizer needs sharp and a Node runtime, neither of
    // which exists on Workers, so `next/image` would fail at request time.
    // Serving the file as-is from the ASSETS binding is the right trade for
    // a handful of static screenshots.
    unoptimized: true,
  },
};

export default nextConfig;

// Makes the Cloudflare bindings (D1) available during `next dev`, so local
// development reads the same database wrangler provisions. Deliberately not
// awaited: `next.config.ts` is required synchronously and cannot contain
// top-level await.
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev();
}
