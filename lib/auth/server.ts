import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";

const NEON_AUTH_BASE_URL = "https://ep-dark-shape-aflnginj.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth";

function cookieSecret() {
  const source =
    process.env.NEON_AUTH_COOKIE_SECRET?.trim() ||
    process.env.AFTERMARKET_VAULT_KEY?.trim() ||
    process.env.DYNADOT_API_SECRET?.trim() ||
    process.env.DOMAIN_RADAR_REGISTRATION_TOKEN?.trim() ||
    "";
  if (!source) throw new Error("Domain Radar auth cookie secret is not configured.");
  return createHash("sha256").update("domain-radar/neon-auth/v1\0").update(source).digest("base64url");
}

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL?.trim() || NEON_AUTH_BASE_URL,
  cookies: { secret: cookieSecret() },
});
