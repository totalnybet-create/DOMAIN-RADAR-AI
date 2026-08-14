export const runtime = "nodejs";

export type RegistrarQuote = {
  id: "porkbun" | "cloudflare" | "godaddy" | "dynadot" | "namecheap";
  name: string;
  status: "live" | "tld-price" | "not-configured" | "unavailable" | "error";
  available?: boolean;
  registration?: number;
  renewal?: number;
  currency?: string;
  premium?: boolean;
  note?: string;
  buyUrl: string;
};

type CacheEntry = { expiresAt: number; quotes: RegistrarQuote[] };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 5 * 60 * 1000;

function validDomain(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

function tldOf(domain: string) {
  return domain.toLowerCase().split(".").slice(1).join(".");
}

function n(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function porkbun(domain: string): Promise<RegistrarQuote> {
  const tld = tldOf(domain);
  const apikey = process.env.PORKBUN_API_KEY;
  const secretapikey = process.env.PORKBUN_SECRET_API_KEY;
  const buyUrl = `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`;

  if (apikey && secretapikey) {
    try {
      const res = await fetch(`https://api.porkbun.com/api/json/v3/domain/checkDomain/${encodeURIComponent(domain)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey, secretapikey }),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json() as { response?: { avail?: string; price?: string; premium?: string; additional?: { renewal?: { price?: string } } } };
      if (res.ok && data.response) {
        return {
          id: "porkbun",
          name: "Porkbun",
          status: data.response.avail === "yes" ? "live" : "unavailable",
          available: data.response.avail === "yes",
          registration: n(data.response.price),
          renewal: n(data.response.additional?.renewal?.price),
          currency: "USD",
          premium: data.response.premium === "yes",
          note: "Cena i dostępność konkretnej domeny",
          buyUrl,
        };
      }
    } catch {}
  }

  try {
    const res = await fetch("https://api.porkbun.com/api/json/v3/pricing/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tlds: [tld] }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as { pricing?: Record<string, { registration?: string; renewal?: string }> };
    const row = data.pricing?.[tld];
    if (res.ok && row) {
      return {
        id: "porkbun",
        name: "Porkbun",
        status: "tld-price",
        registration: n(row.registration),
        renewal: n(row.renewal),
        currency: "USD",
        note: "Aktualna cena standardowa TLD; domena premium może kosztować inaczej",
        buyUrl,
      };
    }
  } catch {}
  return { id: "porkbun", name: "Porkbun", status: "error", note: "Nie udało się pobrać ceny", buyUrl };
}

async function cloudflare(domain: string): Promise<RegistrarQuote> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const buyUrl = accountId
    ? `https://dash.cloudflare.com/${accountId}/domains/registrations`
    : "https://dash.cloudflare.com/";
  if (!accountId || !token) return { id: "cloudflare", name: "Cloudflare", status: "not-configured", note: "Wymaga CLOUDFLARE_ACCOUNT_ID i CLOUDFLARE_API_TOKEN", buyUrl };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/domain-check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domains: [domain] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as { result?: { domains?: Array<{ registrable?: boolean; tier?: string; reason?: string; pricing?: { currency?: string; registration_cost?: string; renewal_cost?: string } }> } };
    const row = data.result?.domains?.[0];
    if (!res.ok || !row) throw new Error("cloudflare-check-failed");
    return {
      id: "cloudflare",
      name: "Cloudflare",
      status: row.registrable ? "live" : "unavailable",
      available: !!row.registrable,
      registration: n(row.pricing?.registration_cost),
      renewal: n(row.pricing?.renewal_cost),
      currency: row.pricing?.currency,
      premium: row.tier === "premium",
      note: row.reason || "Real-time registry check",
      buyUrl,
    };
  } catch {
    return { id: "cloudflare", name: "Cloudflare", status: "error", note: "Błąd API", buyUrl };
  }
}

async function godaddy(domain: string): Promise<RegistrarQuote> {
  const token = process.env.GODADDY_PAT;
  const buyUrl = `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`;
  if (!token) return { id: "godaddy", name: "GoDaddy", status: "not-configured", note: "Wymaga GODADDY_PAT", buyUrl };
  try {
    const res = await fetch(`https://api.godaddy.com/v3/domains/check-availability?domain=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as { available?: boolean; prices?: Array<{ period?: number; price?: { currencyCode?: string; value?: number }; renewalPrice?: { currencyCode?: string; value?: number } }> };
    const oneYear = data.prices?.find((p) => p.period === 1) ?? data.prices?.[0];
    if (!res.ok) throw new Error("godaddy-check-failed");
    return {
      id: "godaddy",
      name: "GoDaddy",
      status: data.available ? "live" : "unavailable",
      available: !!data.available,
      registration: oneYear?.price?.value == null ? undefined : oneYear.price.value / 100,
      renewal: oneYear?.renewalPrice?.value == null ? undefined : oneYear.renewalPrice.value / 100,
      currency: oneYear?.price?.currencyCode ?? oneYear?.renewalPrice?.currencyCode,
      note: "Cena konkretnej domeny",
      buyUrl,
    };
  } catch {
    return { id: "godaddy", name: "GoDaddy", status: "error", note: "Błąd API", buyUrl };
  }
}

async function dynadot(domain: string): Promise<RegistrarQuote> {
  const key = process.env.DYNADOT_API_KEY;
  const buyUrl = `https://www.dynadot.com/domain/search.html?domain=${encodeURIComponent(domain)}`;
  if (!key) return { id: "dynadot", name: "Dynadot", status: "not-configured", note: "Wymaga DYNADOT_API_KEY", buyUrl };
  try {
    const url = new URL("https://api.dynadot.com/api3.json");
    url.searchParams.set("key", key);
    url.searchParams.set("command", "search");
    url.searchParams.set("domain0", domain);
    url.searchParams.set("show_price", "1");
    url.searchParams.set("currency", "USD");
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const data = await res.json() as { SearchResponse?: { SearchResults?: Array<{ Available?: string; Price?: string }> } };
    const row = data.SearchResponse?.SearchResults?.[0];
    if (!res.ok || !row) throw new Error("dynadot-check-failed");
    const match = row.Price?.match(/([0-9]+(?:\.[0-9]+)?)/);
    const available = row.Available?.toLowerCase() === "yes";
    return {
      id: "dynadot",
      name: "Dynadot",
      status: available ? "live" : "unavailable",
      available,
      registration: match ? n(match[1]) : undefined,
      currency: "USD",
      note: "Cena konkretnej domeny",
      buyUrl,
    };
  } catch {
    return { id: "dynadot", name: "Dynadot", status: "error", note: "Błąd API", buyUrl };
  }
}

async function namecheap(domain: string): Promise<RegistrarQuote> {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const username = process.env.NAMECHEAP_USERNAME;
  const clientIp = process.env.NAMECHEAP_CLIENT_IP;
  const buyUrl = `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
  if (!apiUser || !apiKey || !username || !clientIp) return { id: "namecheap", name: "Namecheap", status: "not-configured", note: "Wymaga danych API Namecheap i stałego ClientIP", buyUrl };
  try {
    const base = new URL("https://api.namecheap.com/xml.response");
    base.searchParams.set("ApiUser", apiUser);
    base.searchParams.set("ApiKey", apiKey);
    base.searchParams.set("UserName", username);
    base.searchParams.set("ClientIp", clientIp);
    base.searchParams.set("Command", "namecheap.domains.check");
    base.searchParams.set("DomainList", domain);
    const checkRes = await fetch(base, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const xml = await checkRes.text();
    const available = /Available="true"/i.test(xml);
    const premium = /IsPremiumName="true"/i.test(xml);
    const premiumPrice = xml.match(/PremiumRegistrationPrice="([0-9.]+)"/i)?.[1];
    const premiumRenewal = xml.match(/PremiumRenewalPrice="([0-9.]+)"/i)?.[1];
    if (!available) return { id: "namecheap", name: "Namecheap", status: "unavailable", available: false, premium, note: "Namecheap check", buyUrl };
    if (premium && premiumPrice && Number(premiumPrice) > 0) {
      return { id: "namecheap", name: "Namecheap", status: "live", available: true, premium: true, registration: n(premiumPrice), renewal: n(premiumRenewal), currency: "USD", note: "Premium — cena konkretnej domeny", buyUrl };
    }

    const tld = tldOf(domain).toUpperCase();
    const priceUrl = new URL("https://api.namecheap.com/xml.response");
    priceUrl.searchParams.set("ApiUser", apiUser);
    priceUrl.searchParams.set("ApiKey", apiKey);
    priceUrl.searchParams.set("UserName", username);
    priceUrl.searchParams.set("ClientIp", clientIp);
    priceUrl.searchParams.set("Command", "namecheap.users.getPricing");
    priceUrl.searchParams.set("ProductType", "DOMAIN");
    priceUrl.searchParams.set("ProductCategory", "DOMAINS");
    priceUrl.searchParams.set("ActionName", "REGISTER");
    priceUrl.searchParams.set("ProductName", tld);
    const priceRes = await fetch(priceUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const priceXml = await priceRes.text();
    const price = priceXml.match(/<Price[^>]*Duration="1"[^>]*Price="([0-9.]+)"/i)?.[1];
    const currency = priceXml.match(/<Price[^>]*Duration="1"[^>]*Currency="([A-Z]+)"/i)?.[1] ?? "USD";
    return { id: "namecheap", name: "Namecheap", status: "live", available: true, registration: n(price), currency, note: "Dostępność domeny + aktualna cena TLD", buyUrl };
  } catch {
    return { id: "namecheap", name: "Namecheap", status: "error", note: "Błąd API", buyUrl };
  }
}

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase() ?? "";
  if (!validDomain(domain)) return Response.json({ error: "Invalid domain" }, { status: 400 });

  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return Response.json({ domain, quotes: cached.quotes, cached: true });

  const quotes = await Promise.all([porkbun(domain), cloudflare(domain), godaddy(domain), dynadot(domain), namecheap(domain)]);
  cache.set(domain, { quotes, expiresAt: Date.now() + CACHE_MS });
  const confirmedAvailable = quotes.filter((q) => q.status === "live" && q.available === true).length;
  const confirmedUnavailable = quotes.filter((q) => q.status === "unavailable" && q.available === false).length;

  return Response.json({ domain, quotes, confirmedAvailable, confirmedUnavailable, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, max-age=60" } });
}
