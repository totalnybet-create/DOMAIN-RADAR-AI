import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
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
