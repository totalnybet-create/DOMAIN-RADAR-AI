import { getDynadotConfig, isDynadotConfigured, searchDynadotDomains } from "@/lib/dynadot";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_TLDS = ["pl", "com", "eu", "online", "shop"];
const ALLOWED_TLDS = new Set(["pl", "com", "eu", "io", "ai", "net", "org", "co", "de", "cz", "shop", "store", "online"]);

function cleanLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\..*$/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export async function POST(request: Request) {
  if (!isDynadotConfigured()) {
    return Response.json(
      { connected: false, error: "Dynadot API is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { query?: string; tlds?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const label = cleanLabel(body.query || "");
  if (!label) return Response.json({ error: "Enter a domain name." }, { status: 400 });

  const requested = Array.isArray(body.tlds) ? body.tlds : DEFAULT_TLDS;
  const tlds = Array.from(new Set(requested.map((value) => value.replace(/^\./, "").toLowerCase()).filter((value) => ALLOWED_TLDS.has(value)))).slice(0, 13);
  if (!tlds.length) return Response.json({ error: "Select at least one TLD." }, { status: 400 });

  const domains = tlds.map((tld) => `${label}.${tld}`);
  try {
    const live = await searchDynadotDomains(domains);
    const config = getDynadotConfig();
    const results = domains.map((domain) => {
      const item = live.get(domain);
      return {
        domain,
        state: item?.state || "unknown",
        premium: item?.premium || false,
        currency: item?.price?.currency || config.currency,
        price: item?.retailPrice,
        renewalPrice: item?.price?.renewalPrice,
      };
    });
    return Response.json(
      { connected: true, currency: config.currency, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { connected: true, error: error instanceof Error ? error.message : "Dynadot lookup failed." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
