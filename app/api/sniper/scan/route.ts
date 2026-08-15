import {
  domainAgeYears,
  getAftermarketConfig,
  isAftermarketConfigured,
  listExpiringPl,
  listPlAuctions,
  scoreAuction,
  scoreExpiring,
  trademarkRisk,
} from "@/lib/aftermarket";

export const runtime = "nodejs";
export const maxDuration = 60;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampFloat(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(request: Request) {
  if (!isAftermarketConfigured()) {
    return Response.json(
      {
        connected: false,
        error: "AfterMarket API is not configured.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "auctions" ? "auctions" : "expiring";
  const config = getAftermarketConfig();
  const limit = clampInt(url.searchParams.get("limit"), 250, 25, 1000);
  const maxLength = clampInt(url.searchParams.get("maxLength"), 14, 3, 30);
  const minScore = clampInt(url.searchParams.get("minScore"), config.minScore, 0, 100);
  const maxPrice = clampFloat(url.searchParams.get("maxPrice"), config.maxDomainPrice, 1, 100000);

  try {
    if (mode === "auctions") {
      const source = await listPlAuctions({
        size: Math.min(5000, Math.max(limit * 3, 500)),
        maxLength,
        maxPrice,
      });

      const results = source
        .map((item) => ({
          type: "auction" as const,
          domain: item.nameIDN || item.name,
          domainAscii: item.name,
          score: scoreAuction(item),
          trademarkRisk: trademarkRisk(item.name),
          auctionId: item.auctionId,
          price: item.price,
          minBid: item.minBid,
          priceBuyNow: item.priceBuyNow,
          currency: item.currency || "PLN",
          bids: item.bids || 0,
          watched: item.watched || 0,
          visits: item.visits || 0,
          endtime: item.endtime,
          catch: Boolean(item.catch),
        }))
        .filter((item) => item.score >= minScore && !item.trademarkRisk)
        .sort((a, b) => b.score - a.score || (a.minBid ?? a.price ?? Infinity) - (b.minBid ?? b.price ?? Infinity))
        .slice(0, limit);

      return Response.json(
        {
          connected: true,
          mode,
          scanned: source.length,
          qualified: results.length,
          limits: { limit, maxLength, minScore, maxPrice },
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const source = await listExpiringPl({
      size: Math.min(5000, Math.max(limit * 4, 750)),
      maxLength,
      order: "deleted",
    });

    const results = source
      .map((item) => ({
        type: "expiring" as const,
        domain: item.nameIDN || item.name,
        domainAscii: item.name,
        score: scoreExpiring(item),
        trademarkRisk: trademarkRisk(item.name),
        length: (item.string || item.name.split(".")[0] || "").length,
        ageYears: domainAgeYears(item.createdTime),
        archive: item.archive,
        created: item.created,
        deleted: item.deleted,
        deletedTime: item.deletedTime,
        expires: item.expires,
        expiresTime: item.expiresTime,
        majesticQuality: item.majesticQuality || 0,
        majesticDomains: item.majesticDomains || 0,
        majesticLinks: item.majesticLinks || 0,
        pages: item.pages || 0,
        registrar: item.registrar,
        future: Boolean(item.future),
      }))
      .filter((item) => item.score >= minScore && !item.trademarkRisk)
      .sort((a, b) => b.score - a.score || (b.majesticQuality || 0) - (a.majesticQuality || 0) || (a.deletedTime || Infinity) - (b.deletedTime || Infinity))
      .slice(0, limit);

    return Response.json(
      {
        connected: true,
        mode,
        scanned: source.length,
        qualified: results.length,
        limits: { limit, maxLength, minScore, maxPrice },
        results,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        connected: true,
        error: error instanceof Error ? error.message : "PL Sniper scan failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
