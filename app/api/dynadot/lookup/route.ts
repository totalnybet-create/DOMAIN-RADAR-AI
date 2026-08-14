import { getDynadotConfig, isDynadotConfigured, searchDynadotDomains } from "@/lib/dynadot";
import { checkDomain } from "@/lib/rdap";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_TLDS = ["pl", "com", "eu", "online", "shop"];
const ALLOWED_TLDS = new Set(["pl", "com", "eu", "io", "ai", "net", "org", "co", "de", "cz", "shop", "store", "online"]);

function cleanLabel(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/^https?:///, "").replace(/^www./, "").replace(/..*$/, "")
    .replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 63);
}

function configuredPlPrice(kind: "registration" | "renewal") {
  const raw = kind === "registration" ? process.env.DYNADOT_PL_REGISTRATION_PRICE : process.env.DYNADOT_PL_RENEWAL_PRICE;
  const value = Number.parseFloat(raw || "");
  return Number.isFinite(value) ? value : undefined;
}

export async function POST(request: Request) {
  if (!isDynadotConfigured()) return Response.json({ connected: false, error: "Dynadot API is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  let body: { query?: string; tlds?: string[] };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const label = cleanLabel(body.query || "");
  if (!label) return Response.json({ error: "Enter a domain name." }, { status: 400 });
  const requested = Array.isArray(body.tlds) ? body.tlds : DEFAULT_TLDS;
  const tlds = Array.from(new Set(requested.map((value) => value.replace(/^./, "").toLowerCase()).filter((value) => ALLOWED_TLDS.has(value)))).slice(0, 13);
  if (!tlds.length) return Response.json({ error: "Select at least one TLD." }, { status: 400 });

  const domains = tlds.map((tld) => `${label}.${tld}`);
  try {
    const config = getDynadotConfig();
    const nonPlDomains = domains.filter((domain) => !domain.endsWith(".pl"));
    const live = nonPlDomains.length ? await searchDynadotDomains(nonPlDomains) : new Map();
    const plDomain = domains.find((domain) => domain.endsWith(".pl"));
    const plStatus = plDomain ? await checkDomain(plDomain) : null;
    const plRegistration = configuredPlPrice("registration");
    const plRenewal = configuredPlPrice("renewal");
    const results = domains.map((domain) => {
      if (domain.endsWith(".pl")) {
        const price = plRegistration;
        return { domain, state: plStatus?.state || "unknown", premium: false, currency: (process.env.DYNADOT_PL_PRICE_CURRENCY || config.currency).toUpperCase(), price, renewalPrice: plRenewal, detailsError: price === undefined ? "Uzupełnij cenę konta Dynadot dla .pl w zmiennych środowiskowych." : undefined };
      }
      const item = live.get(domain);
      return { domain, state: item?.state || "unknown", premium: item?.premium || false, currency: item?.price?.currency || config.currency, price: item?.retailPrice, renewalPrice: item?.price?.renewalPrice, detailsError: item?.detailsError };
    });
    return Response.json({ connected: true, currency: config.currency, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ connected: true, error: error instanceof Error ? error.message : "Dynadot lookup failed." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
