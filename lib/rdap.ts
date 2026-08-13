import type { DomainState } from "./types";

type Bootstrap = { services: Array<[string[], string[]]> };
type CheckResult = { state: DomainState; statusCode?: number; reason?: string; checkedAt?: string; cached?: boolean };

const CHECK_TTL_MS = 15 * 60 * 1000;
let bootstrapCache: { data: Bootstrap; expiresAt: number } | null = null;
const checkCache = new Map<string, { result: CheckResult; expiresAt: number }>();

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

export async function checkDomain(domainRaw: string): Promise<CheckResult> {
  const domain = domainRaw.toLowerCase();
  const cached = checkCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };

  const tld = domain.split(".").pop();
  if (!tld) return { state: "unknown", reason: "invalid-domain" };
  const base = await resolveRdapBase(tld);
  if (!base) return { state: "unknown", reason: "no-rdap-service" };

  const url = `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`;
  let result: CheckResult;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (response.status === 404) result = { state: "available", statusCode: 404 };
    else if (response.ok) result = { state: "registered", statusCode: response.status };
    else if (response.status === 429) result = { state: "unknown", statusCode: 429, reason: "rate-limited" };
    else result = { state: "unknown", statusCode: response.status, reason: `rdap-${response.status}` };
  } catch (error) {
    const reason = error instanceof Error ? error.name === "TimeoutError" ? "timeout" : error.message : "rdap-error";
    result = { state: "unknown", reason };
  }

  result.checkedAt = new Date().toISOString();
  if (result.state !== "unknown") checkCache.set(domain, { result, expiresAt: Date.now() + CHECK_TTL_MS });
  return result;
}
