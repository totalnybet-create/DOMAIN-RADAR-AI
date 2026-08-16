import {
  domainAgeYears,
  getAftermarketConfig,
  scoreAuctionDetailed,
  scoreExpiringDetailed,
  type ExpiringDomain,
  type MarketAuction,
  type ScoreDetails,
} from "@/lib/aftermarket";
import {
  listExpiringPlRuntime,
  listPlAuctionsRuntime,
  resolveAftermarketCredentials,
} from "@/lib/aftermarket-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

type SignalStatus = "pass" | "fail" | "unknown";
type Signal = { status: SignalStatus; label: string; detail: string };
type Signals = {
  name: Signal;
  history: Signal;
  seo: Signal;
  traffic: Signal;
  market: Signal;
  value: Signal;
  safe: Signal;
};

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
  const window = Math.floor(Date.now() / 1000) % 7;
  return window * scanSize;
}

function signal(status: SignalStatus, label: string, detail: string): Signal {
  return { status, label, detail };
}

function nameSignal(assessment: ScoreDetails) {
  const points = assessment.breakdown.name + assessment.breakdown.commercial;
  const pass = !assessment.rejectedReason && points >= 24;
  return signal(
    pass ? "pass" : "fail",
    "Nazwa",
    assessment.rejectedReason || `${points} pkt za jakość i potencjał komercyjny`,
  );
}

function safeSignal(assessment: ScoreDetails) {
  const pass = !assessment.trademarkRisk && !assessment.rejectedReason;
  return signal(
    pass ? "pass" : "fail",
    "Ryzyko",
    assessment.trademarkRisk ? "oczywiste ryzyko znaku towarowego" : assessment.rejectedReason || "brak oczywistej czerwonej flagi",
  );
}

function expiringSignals(item: ExpiringDomain, assessment: ScoreDetails, ageYears?: number): Signals {
  const hasHistoryData = item.createdTime !== undefined || Boolean(item.archive);
  const historyPass = (ageYears || 0) >= 5 || Boolean(item.archive);
  const hasSeoData = item.majesticQuality !== undefined || item.majesticDomains !== undefined || item.majesticLinks !== undefined;
  const seoPass = (item.majesticQuality || 0) >= 5 || (item.majesticDomains || 0) >= 3 || (item.majesticLinks || 0) >= 20;
  const hasTrafficProxy = item.pages !== undefined || item.majesticDomains !== undefined;
  const trafficPass = (item.pages || 0) >= 10 || (item.majesticDomains || 0) >= 10;
  const now = Date.now() / 1000;
  const hoursToDrop = item.deletedTime ? (item.deletedTime - now) / 3600 : undefined;
  const marketPass = assessment.breakdown.market >= 3 || (hoursToDrop !== undefined && hoursToDrop >= 0 && hoursToDrop <= 168);

  return {
    name: nameSignal(assessment),
    history: hasHistoryData
      ? signal(historyPass ? "pass" : "fail", "Historia", historyPass ? `${ageYears || 0} lat / archiwum obecne` : "krótka lub słaba historia")
      : signal("unknown", "Historia", "brak danych historycznych w tym rekordzie"),
    seo: hasSeoData
      ? signal(seoPass ? "pass" : "fail", "SEO", `TF ${item.majesticQuality || 0} · ref. domeny ${item.majesticDomains || 0}`)
      : signal("unknown", "SEO", "brak metryk Majestic"),
    traffic: hasTrafficProxy
      ? signal(trafficPass ? "pass" : "fail", "Ruch*", `${item.pages || 0} stron · ${item.majesticDomains || 0} ref. domen`)
      : signal("unknown", "Ruch*", "brak bezpośrednich danych o historycznym ruchu"),
    market: signal(marketPass ? "pass" : "fail", "Rynek", hoursToDrop !== undefined ? `${Math.max(0, Math.round(hoursToDrop))} h do dropu` : "brak pilnego sygnału rynkowego"),
    value: signal("unknown", "Wartość", "brak ceny nabycia w rekordzie wygasającym"),
    safe: safeSignal(assessment),
  };
}

function auctionSignals(item: MarketAuction, assessment: ScoreDetails, valuePrice: number): Signals {
  const now = Date.now() / 1000;
  const hoursLeft = item.auctionEndTime ? (item.auctionEndTime - now) / 3600 : undefined;
  const marketPass = (item.offers || 0) > 0 || item.auctionKind === "last-minute" || item.auctionKind === "caught" || (hoursLeft !== undefined && hoursLeft <= 24);
  const price = item.price ?? item.priceMinimum;
  const valueKnown = price !== undefined;
  const valuePass = valueKnown && price <= valuePrice;

  return {
    name: nameSignal(assessment),
    history: signal("unknown", "Historia", "listing aukcyjny nie zawiera pełnej historii domeny"),
    seo: signal("unknown", "SEO", "listing aukcyjny nie zawiera pełnych metryk SEO"),
    traffic: signal("unknown", "Ruch*", "brak wiarygodnych danych o historycznym ruchu w tym rekordzie"),
    market: signal(marketPass ? "pass" : "fail", "Rynek", `${item.offers || 0} ofert${hoursLeft !== undefined ? ` · ${Math.max(0, Math.round(hoursLeft))} h do końca` : ""}`),
    value: valueKnown
      ? signal(valuePass ? "pass" : "fail", "Wartość", `${price} ${item.currency || "PLN"} względem progu ${valuePrice} PLN`)
      : signal("unknown", "Wartość", "brak aktualnej ceny"),
    safe: safeSignal(assessment),
  };
}

function passCount(signals: Signals) {
  return Object.values(signals).filter((item) => item.status === "pass").length;
}

function evaluateExpiring(item: ExpiringDomain) {
  const assessment = scoreExpiringDetailed(item);
  const ageYears = domainAgeYears(item.createdTime);
  const signals = expiringSignals(item, assessment, ageYears);
  return {
    type: "expiring" as const,
    source: "DROP" as const,
    domain: item.nameIDN || item.name,
    domainAscii: item.name,
    score: assessment.score,
    tier: assessment.tier,
    reasons: assessment.reasons,
    breakdown: assessment.breakdown,
    trademarkRisk: assessment.trademarkRisk,
    rejectedReason: assessment.rejectedReason,
    signals,
    passCount: passCount(signals),
    length: (item.string || item.name.split(".")[0] || "").length,
    ageYears,
    archive: item.archive,
    created: item.created,
    createdTime: item.createdTime,
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
}

function evaluateAuction(item: MarketAuction, scoreReferencePrice: number) {
  const assessment = scoreAuctionDetailed(item, scoreReferencePrice);
  const signals = auctionSignals(item, assessment, scoreReferencePrice);
  const source = item.auctionKind === "last-minute" ? "LAST MINUTE" : item.auctionKind === "caught" ? "CAUGHT" : item.auctionKind === "cheap" ? "TANIA" : "AUKCJA";
  return {
    type: "auction" as const,
    source,
    domain: item.nameIDN || item.name,
    domainAscii: item.name,
    score: assessment.score,
    tier: assessment.tier,
    reasons: assessment.reasons,
    breakdown: assessment.breakdown,
    trademarkRisk: assessment.trademarkRisk,
    rejectedReason: assessment.rejectedReason,
    signals,
    passCount: passCount(signals),
    auctionId: item.auctionId,
    auctionKind: item.auctionKind,
    price: item.price,
    minBid: item.price ?? item.priceMinimum,
    priceBuyNow: item.auctionPriceBuyNow,
    currency: item.currency || "PLN",
    bids: item.offers || 0,
    endtime: item.auctionEndTime,
    catch: item.auctionKind === "caught",
    featured: Boolean(item.featured),
    homepage: Boolean(item.homepage),
  };
}

function sortMarket<T extends { passCount: number; score: number; domainAscii: string }>(items: T[]) {
  return items.sort((a, b) => b.passCount - a.passCount || b.score - a.score || a.domainAscii.localeCompare(b.domainAscii));
}

export async function GET(request: Request) {
  const credentials = resolveAftermarketCredentials(request);
  if (!credentials) {
    return Response.json(
      { connected: false, error: "AfterMarket API is not configured. Use Połącz AfterMarket in Domain Radar." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const rawMode = url.searchParams.get("mode");
  const mode = rawMode === "market" || rawMode === "ending" || rawMode === "auctions" ? rawMode : "expiring";
  const config = getAftermarketConfig();
  const limit = clampInt(url.searchParams.get("limit"), mode === "market" ? 1000 : 100, 10, 1500);
  const maxLength = clampInt(url.searchParams.get("maxLength"), mode === "market" ? 24 : 14, 3, 30);
  const minScore = clampInt(url.searchParams.get("minScore"), config.minScore, 0, 100);
  const maxPrice = clampFloat(url.searchParams.get("maxPrice"), mode === "market" || mode === "ending" ? 100000 : config.maxDomainPrice, 1, 100000);
  const startedAt = Date.now();

  try {
    if (mode === "market") {
      const perSourceSize = Math.min(800, Math.max(300, Math.ceil(limit * 0.7)));
      const start = url.searchParams.has("start") ? clampInt(url.searchParams.get("start"), 0, 0, 50000) : 0;
      console.info("[PL_SNIPER_MARKET_START]", { start, perSourceSize, limit, maxLength, priceFilter: "none" });

      const [expiringResult, auctionResult] = await Promise.allSettled([
        listExpiringPlRuntime(credentials, { size: perSourceSize, start, maxLength, order: "deleted", qualityPrefilter: false }),
        listPlAuctionsRuntime(credentials, { size: perSourceSize, start, maxLength, maxPrice: null, order: "price", qualityPrefilter: false }),
      ]);

      const expiring = expiringResult.status === "fulfilled" ? expiringResult.value : [];
      const auctions = auctionResult.status === "fulfilled" ? auctionResult.value : [];
      const warnings: string[] = [];
      if (expiringResult.status === "rejected") warnings.push(`DROP: ${expiringResult.reason instanceof Error ? expiringResult.reason.message : "błąd źródła"}`);
      if (auctionResult.status === "rejected") warnings.push(`AUKCJE: ${auctionResult.reason instanceof Error ? auctionResult.reason.message : "błąd źródła"}`);
      if (!expiring.length && !auctions.length) throw new Error(warnings.join(" · ") || "AfterMarket nie zwrócił danych rynku.");

      const evaluated = [...expiring.map(evaluateExpiring), ...auctions.map((item) => evaluateAuction(item, config.maxDomainPrice))];
      const deduped = new Map<string, (typeof evaluated)[number]>();
      for (const item of evaluated) {
        const key = item.domainAscii.toLowerCase();
        const existing = deduped.get(key);
        if (!existing || item.passCount > existing.passCount || (item.passCount === existing.passCount && item.score > existing.score)) deduped.set(key, item);
      }
      const results = sortMarket([...deduped.values()]).slice(0, limit);

      console.info("[PL_SNIPER_MARKET_DONE]", {
        start,
        expiring: expiring.length,
        auctions: auctions.length,
        returned: results.length,
        durationMs: Date.now() - startedAt,
      });

      return Response.json(
        {
          connected: true,
          connectionSource: credentials.source,
          engine: "SZTOS_MARKET_WORKBENCH_V1",
          mode,
          scanStart: start,
          nextStart: start + perSourceSize,
          scanned: expiring.length + auctions.length,
          sourceCounts: { expiring: expiring.length, auctions: auctions.length },
          warnings,
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (mode === "ending") {
      const source = await listPlAuctionsRuntime(credentials, {
        size: 800,
        start: 0,
        maxLength: 30,
        maxPrice: null,
        order: "endtime",
        qualityPrefilter: false,
      });
      const now = Date.now() / 1000;
      const results = source
        .map((item) => evaluateAuction(item, config.maxDomainPrice))
        .filter((item) => item.endtime && item.endtime > now)
        .sort((a, b) => (a.endtime || Infinity) - (b.endtime || Infinity))
        .slice(0, Math.min(limit, 80));

      return Response.json(
        {
          connected: true,
          connectionSource: credentials.source,
          engine: "SZTOS_LIVE_ENDING_V1",
          mode,
          scanned: source.length,
          returned: results.length,
          serverTime: Math.floor(now),
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (mode === "auctions") {
      const scanSize = Math.min(800, Math.max(limit * 2, 300));
      let start = scanStart(url, scanSize);
      let source = await listPlAuctionsRuntime(credentials, { size: scanSize, start, maxLength, maxPrice });
      if (!source.length && start > 0) {
        start = 0;
        source = await listPlAuctionsRuntime(credentials, { size: scanSize, start, maxLength, maxPrice });
      }
      const evaluated = source.map((item) => evaluateAuction(item, maxPrice));
      const qualified = evaluated.filter((item) => !item.rejectedReason && item.score >= minScore && !item.trademarkRisk);
      const results = sortMarket(qualified).slice(0, limit);
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
          bestScoreSeen: evaluated.reduce((best, item) => Math.max(best, item.score), 0),
          limits: { limit, maxLength, minScore, maxPrice },
          results,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const scanSize = Math.min(800, Math.max(limit * 2, 250));
    let start = scanStart(url, scanSize);
    let source = await listExpiringPlRuntime(credentials, { size: scanSize, start, maxLength, order: "deleted" });
    if (!source.length && start > 0) {
      start = 0;
      source = await listExpiringPlRuntime(credentials, { size: scanSize, start, maxLength, order: "deleted" });
    }
    const evaluated = source.map(evaluateExpiring);
    const qualified = evaluated.filter((item) => !item.rejectedReason && item.score >= minScore && !item.trademarkRisk);
    const results = sortMarket(qualified).slice(0, limit);
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
        bestScoreSeen: evaluated.reduce((best, item) => Math.max(best, item.score), 0),
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
      { connected: true, connectionSource: credentials.source, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
