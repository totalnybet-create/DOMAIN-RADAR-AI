import {
  domainAgeYears,
  getAftermarketConfig,
  scoreAuctionDetailed,
  scoreExpiringDetailed,
} from "@/lib/aftermarket";
import {
  listExpiringPlRuntime,
  listPlAuctionsRuntime,
  resolveAftermarketCredentials,
} from "@/lib/aftermarket-runtime";

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

function scanStart(url: URL, scanSize: number) {
  const explicit = url.searchParams.get("start");
  if (explicit !== null) return clampInt(explicit, 0, 0, 50000);

  // Manual scans should not hammer the same first page forever. Seven windows makes
  // consecutive clicks rotate naturally and also works well with future 5-minute cron runs.
  const window = Math.floor(Date.now() / 1000) % 7;
  return window * scanSize;
}

export async function GET(request: Request) {
  const credentials = resolveAftermarketCredentials(request);
  if (!credentials) {
    return Response.json(
      {
        connected: false,
        error: "AfterMarket API is not configured. Use Połącz AfterMarket in Domain Radar.",
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
  const startedAt = Date.now();

  try {
    if (mode === "auctions") {
      const scanSize = Math.min(800, Math.max(limit * 2, 300));
      let start = scanStart(url, scanSize);
      console.info("[PL_SNIPER_SCAN_START]", { mode, limit, scanSize, start, maxLength, maxPrice });

      let source = await listPlAuctionsRuntime(credentials, {
        size: scanSize,
        start,
        maxLength,
        maxPrice,
      });

      if (!source.length && start > 0) {
        start = 0;
        source = await listPlAuctionsRuntime(credentials, {
          size: scanSize,
          start,
          maxLength,
          maxPrice,
        });
      }

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
      const bestScoreSeen = evaluated.reduce((best, item) => Math.max(best, item.score), 0);

      console.info("[PL_SNIPER_SCAN_DONE]", {
        mode,
        start,
        scanned: source.length,
        qualified: qualified.length,
        returned: results.length,
        bestScoreSeen,
        durationMs: Date.now() - startedAt,
      });

      return Response.json(
        {
          connected: true,
          connectionSource: credentials.source,
          engine: "SZTOS_SCORE_V2",
          mode,
          scanStart: start,
          nextStart: start + scanSize,
          scanned: source.length,
          qualified: qualified.length,
          returned: results.length,
          rejected: source.length - qualified.length,
          bestScoreSeen,
          limits: { limit, maxLength, minScore, maxPrice },
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const scanSize = Math.min(800, Math.max(limit * 2, 250));
    let start = scanStart(url, scanSize);
    console.info("[PL_SNIPER_SCAN_START]", { mode, limit, scanSize, start, maxLength });

    let source = await listExpiringPlRuntime(credentials, {
      size: scanSize,
      start,
      maxLength,
      order: "deleted",
    });

    if (!source.length && start > 0) {
      start = 0;
      source = await listExpiringPlRuntime(credentials, {
        size: scanSize,
        start,
        maxLength,
        order: "deleted",
      });
    }

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
    const bestScoreSeen = evaluated.reduce((best, item) => Math.max(best, item.score), 0);

    console.info("[PL_SNIPER_SCAN_DONE]", {
      mode,
      start,
      scanned: source.length,
      qualified: qualified.length,
      returned: results.length,
      bestScoreSeen,
      durationMs: Date.now() - startedAt,
    });

    return Response.json(
      {
        connected: true,
        connectionSource: credentials.source,
        engine: "SZTOS_SCORE_V2",
        mode,
        scanStart: start,
        nextStart: start + scanSize,
        scanned: source.length,
        qualified: qualified.length,
        returned: results.length,
        rejected: source.length - qualified.length,
        bestScoreSeen,
        limits: { limit, maxLength, minScore, maxPrice },
        results,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "PL Sniper scan failed.";
    console.error("[PL_SNIPER_SCAN_ERROR]", {
      mode,
      message,
      errorName: error instanceof Error ? error.name : "UnknownError",
      durationMs: Date.now() - startedAt,
    });

    return Response.json(
      {
        connected: true,
        connectionSource: credentials.source,
        engine: "SZTOS_SCORE_V2",
        error: message,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
