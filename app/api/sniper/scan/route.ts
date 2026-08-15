import {
  domainAgeYears,
  getAftermarketConfig,
  isAftermarketConfigured,
  listExpiringPl,
  listPlAuctions,
  scoreAuctionDetailed,
  scoreExpiringDetailed,
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
  const limit = clampInt(url.searchParams.get("limit"), 100, 10, 1000);
  const maxLength = clampInt(url.searchParams.get("maxLength"), 14, 3, 30);
  const minScore = clampInt(url.searchParams.get("minScore"), config.minScore, 0, 100);
  const maxPrice = clampFloat(url.searchParams.get("maxPrice"), config.maxDomainPrice, 1, 100000);

  try {
    if (mode === "auctions") {
      const source = await listPlAuctions({
        size: Math.min(5000, Math.max(limit * 8, 800)),
        maxLength,
        maxPrice,
      });

      const evaluated = source.map((item) => {
        const assessment = scoreAuctionDetailed(item, maxPrice);
        return {
          type: "auction" as const,
          domain: item.nameIDN || item.name,
          domainAscii: item.name,
          score: assessment.score,
          tier: assessment.tier,
          reasons: assessment.reasons,
          breakdown: assessment.breakdown,
          trademarkRisk: assessment.trademarkRisk,
          rejectedReason: assessment.rejectedReason,
          auctionId: item.auctionId,
          auctionKind: item.auctionKind,
          price: item.price,
          minBid: item.price ?? item.priceMinimum,
          priceBuyNow: item.auctionPriceBuyNow,
          currency: item.currency || "PLN",
          bids: item.offers || 0,
          watched: 0,
          visits: 0,
          endtime: item.auctionEndTime,
          catch: item.auctionKind === "caught",
          featured: Boolean(item.featured),
          homepage: Boolean(item.homepage),
        };
      });

      const qualified = evaluated
        .filter((item) => !item.rejectedReason && item.score >= minScore && !item.trademarkRisk)
        .sort((a, b) => b.score - a.score || (a.minBid ?? a.price ?? Infinity) - (b.minBid ?? b.price ?? Infinity));
      const results = qualified.slice(0, limit);

      return Response.json(
        {
          connected: true,
          engine: "SZTOS_SCORE_V2",
          mode,
          scanned: source.length,
          qualified: qualified.length,
          returned: results.length,
          rejected: source.length - qualified.length,
          limits: { limit, maxLength, minScore, maxPrice },
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const source = await listExpiringPl({
      size: Math.min(5000, Math.max(limit * 10, 1000)),
      maxLength,
      order: "deleted",
    });

    const evaluated = source.map((item) => {
      const assessment = scoreExpiringDetailed(item);
      return {
        type: "expiring" as const,
        domain: item.nameIDN || item.name,
        domainAscii: item.name,
        score: assessment.score,
        tier: assessment.tier,
        reasons: assessment.reasons,
        breakdown: assessment.breakdown,
        trademarkRisk: assessment.trademarkRisk,
        rejectedReason: assessment.rejectedReason,
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
        premium: Boolean(item.premium),
      };
    });

    const qualified = evaluated
      .filter((item) => !item.rejectedReason && item.score >= minScore && !item.trademarkRisk)
      .sort((a, b) => b.score - a.score || (b.majesticQuality || 0) - (a.majesticQuality || 0) || (a.deletedTime || Infinity) - (b.deletedTime || Infinity));
    const results = qualified.slice(0, limit);

    return Response.json(
      {
        connected: true,
        engine: "SZTOS_SCORE_V2",
        mode,
        scanned: source.length,
        qualified: qualified.length,
        returned: results.length,
        rejected: source.length - qualified.length,
        limits: { limit, maxLength, minScore, maxPrice },
        results,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        connected: true,
        engine: "SZTOS_SCORE_V2",
        error: error instanceof Error ? error.message : "PL Sniper scan failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
