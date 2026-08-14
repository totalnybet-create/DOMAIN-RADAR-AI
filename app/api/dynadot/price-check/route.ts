import { getDynadotConfig, searchDynadotDomains } from "@/lib/dynadot";

export const runtime = "nodejs";
export const maxDuration = 30;

const TLDS = ["pl", "com", "eu", "online", "shop", "store", "de", "cz", "net", "org", "io", "ai", "co"];

export async function GET() {
  const suffix = Date.now().toString(36);
  const domains = TLDS.map((tld) => `radarprice${suffix}.${tld}`);
  try {
    const live = await searchDynadotDomains(domains);
    const config = getDynadotConfig();
    const results = domains.map((domain) => {
      const item = live.get(domain);
      return {
        tld: domain.slice(domain.lastIndexOf(".") + 1),
        state: item?.state || "unknown",
        currency: item?.price?.currency || config.currency,
        registrationPrice: item?.price?.registrationPrice,
        renewalPrice: item?.price?.renewalPrice,
        retailPrice: item?.retailPrice,
        premium: item?.premium || false,
        detailsError: item?.detailsError,
      };
    });
    return Response.json({ currency: config.currency, markupPercent: config.markupPercent, markupFixed: config.markupFixed, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "price check failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
