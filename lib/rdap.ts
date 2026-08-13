import type { DomainState } from "./types";

type Bootstrap = { services: Array<[string[], string[]]> };
let bootstrapCache: { data: Bootstrap; expiresAt: number } | null = null;

async function getBootstrap(): Promise<Bootstrap> {
  if (bootstrapCache && bootstrapCache.expiresAt > Date.now()) return bootstrapCache.data;
  const response = await fetch("https://data.iana.org/rdap/dns.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`IANA bootstrap failed: ${response.status}`);
  const data = (await response.json()) as Bootstrap;
  bootstrapCache = { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return data;
}

async function resolveRdapBase(tld: string): Promise<string | null> {
  const bootstrap = await getBootstrap();
  const normalized = tld.replace(/^\./, "").toLowerCase();
  for (const [tlds, urls] of bootstrap.services) {
    if (tlds.some((item) => item.toLowerCase() === normalized)) return urls[0] ?? null;
  }
  return null;
}

export async function checkDomain(domain: string): Promise<{ state: DomainState; statusCode?: number; reason?: string }> {
  const tld = domain.split(".").pop();
  if (!tld) return { state: "unknown", reason: "invalid-domain" };
  const base = await resolveRdapBase(tld);
  if (!base) return { state: "unknown", reason: "no-rdap-service" };

  const url = `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (response.status === 404) return { state: "available", statusCode: 404 };
    if (response.ok) return { state: "registered", statusCode: response.status };
    if (response.status === 429) return { state: "unknown", statusCode: 429, reason: "rate-limited" };
    return { state: "unknown", statusCode: response.status, reason: `rdap-${response.status}` };
  } catch (error) {
    const reason = error instanceof Error ? error.name === "TimeoutError" ? "timeout" : error.message : "rdap-error";
    return { state: "unknown", reason };
  }
}
