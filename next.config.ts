import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/aftermarket/connection": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/@sparticuz/chromium/build/**/*",
      "./node_modules/@sparticuz/chromium/package.json",
    ],
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/domains",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
