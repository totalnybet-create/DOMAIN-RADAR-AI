export const runtime = "nodejs";
export const maxDuration = 60;

type Candidate = {
  domain?: string;
  domainAscii?: string;
  source?: string;
  type?: string;
  score?: number;
  ageYears?: number;
  majesticQuality?: number;
  majesticDomains?: number;
  majesticLinks?: number;
  pages?: number;
  archive?: string;
  price?: number;
  minBid?: number;
  currency?: string;
};

type WaybackSignal = {
  ok: boolean;
  captures: number;
  firstYear?: number;
  lastYear?: number;
  spanYears: number;
  error?: string;
};

type CrawlSignal = {
  ok: boolean;
  urls: number;
  index?: string;
  error?: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const log2 = (value: number) => Math.log2(Math.max(1, value));

function cleanDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

async function wayback(domain: string): Promise<WaybackSignal> {
  const target = `${domain}/*`;
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp&filter=statuscode:200&filter=mimetype:text/html&collapse=timestamp:6&limit=200`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6500), headers: { "User-Agent": "DomenaGo-SEO-Hunter/1.0" } });
    if (!response.ok) return { ok: false, captures: 0, spanYears: 0, error: `wayback-${response.status}` };
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) return { ok: false, captures: 0, spanYears: 0, error: "wayback-invalid" };
    const rows = payload.slice(1).filter((row): row is string[] => Array.isArray(row) && typeof row[0] === "string");
    const years = rows.map((row) => Number.parseInt(row[0].slice(0, 4), 10)).filter(Number.isFinite);
    const firstYear = years.length ? Math.min(...years) : undefined;
    const lastYear = years.length ? Math.max(...years) : undefined;
    const spanYears = firstYear && lastYear ? Math.max(0, lastYear - firstYear) : 0;
    return { ok: true, captures: rows.length, firstYear, lastYear, spanYears };
  } catch (error) {
    return { ok: false, captures: 0, spanYears: 0, error: error instanceof Error ? error.name : "wayback-error" };
  }
}

let commonCrawlIndexCache: { id: string; api: string; expiresAt: number } | null = null;

async function latestCommonCrawlIndex() {
  if (commonCrawlIndexCache && commonCrawlIndexCache.expiresAt > Date.now()) return commonCrawlIndexCache;
  const response = await fetch("https://index.commoncrawl.org/collinfo.json", { cache: "no-store", signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`cc-index-${response.status}`);
  const payload = await response.json() as Array<{ id?: string; "cdx-api"?: string }>;
  const first = payload.find((item) => item.id && item["cdx-api"]);
  if (!first?.id || !first["cdx-api"]) throw new Error("cc-index-empty");
  commonCrawlIndexCache = { id: first.id, api: first["cdx-api"], expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return commonCrawlIndexCache;
}

async function commonCrawl(domain: string): Promise<CrawlSignal> {
  try {
    const index = await latestCommonCrawlIndex();
    const url = `${index.api}?url=${encodeURIComponent(domain)}&matchType=domain&output=json&filter=status:200&filter=mime:text/html&collapse=urlkey&limit=100`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6500), headers: { "User-Agent": "DomenaGo-SEO-Hunter/1.0" } });
    if (response.status === 404) return { ok: true, urls: 0, index: index.id };
    if (!response.ok) return { ok: false, urls: 0, index: index.id, error: `cc-${response.status}` };
    const text = await response.text();
    const urls = text.split("\n").filter(Boolean).length;
    return { ok: true, urls, index: index.id };
  } catch (error) {
    return { ok: false, urls: 0, error: error instanceof Error ? error.message : "cc-error" };
  }
}

function providerStatus() {
  return {
    ahrefs: Boolean(process.env.AHREFS_API_TOKEN),
    semrush: Boolean(process.env.SEMRUSH_API_KEY),
    dataForSeo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
    majestic: Boolean(process.env.MAJESTIC_API_KEY),
    similarweb: Boolean(process.env.SIMILARWEB_API_KEY),
    googleAds: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
  };
}

function scoreCandidate(candidate: Candidate, history: WaybackSignal, crawl: CrawlSignal) {
  const age = clamp(candidate.ageYears || 0, 0, 30);
  const tf = clamp(candidate.majesticQuality || 0, 0, 50);
  const refs = Math.max(0, candidate.majesticDomains || 0);
  const links = Math.max(0, candidate.majesticLinks || 0);
  const pages = Math.max(0, candidate.pages || 0);

  const authority = clamp(tf * 0.42 + log2(refs + 1) * 2.5 + log2(links + 1) * 0.55, 0, 30);
  const historical = clamp(age * 0.65 + history.spanYears * 0.9 + Math.min(history.captures, 100) * 0.08, 0, 25);
  const footprint = clamp(log2(pages + 1) * 1.9 + log2(crawl.urls + 1) * 2.2 + log2(refs + 1) * 1.2, 0, 20);
  const existingMarketScore = clamp((candidate.score || 0) / 100 * 10, 0, 10);
  const persistence = clamp((history.ok ? 5 : 0) + (crawl.ok ? 5 : 0) + (candidate.archive ? 3 : 0), 0, 13);

  const linksPerRef = refs > 0 ? links / refs : links;
  let spamRisk = 0;
  if (links > 50000 && refs < 20) spamRisk += 30;
  if (linksPerRef > 1500) spamRisk += 25;
  else if (linksPerRef > 500) spamRisk += 12;
  if (age >= 7 && history.ok && history.captures === 0) spamRisk += 10;
  if (tf === 0 && links > 5000) spamRisk += 12;
  spamRisk = clamp(spamRisk);

  const raw = authority + historical + footprint + existingMarketScore + persistence;
  const recognition = Math.round(clamp(raw - spamRisk * 0.35));

  let confidence = 20;
  if (candidate.ageYears !== undefined) confidence += 10;
  if (candidate.majesticQuality !== undefined || candidate.majesticDomains !== undefined) confidence += 25;
  if (history.ok) confidence += 20;
  if (crawl.ok) confidence += 15;
  if (candidate.pages !== undefined) confidence += 5;
  if (candidate.archive) confidence += 5;
  confidence = Math.round(clamp(confidence));

  const verdict = recognition >= 80 && spamRisk <= 20 ? "STRONG BUY" : recognition >= 65 && spamRisk <= 35 ? "WATCH" : recognition >= 50 ? "REVIEW" : "SKIP";
  return {
    recognition,
    confidence,
    spamRisk: Math.round(spamRisk),
    verdict,
    breakdown: {
      authority: Math.round(authority),
      history: Math.round(historical),
      footprint: Math.round(footprint),
      market: Math.round(existingMarketScore),
      persistence: Math.round(persistence),
    },
  };
}

async function enrich(candidate: Candidate) {
  const domain = cleanDomain(candidate.domainAscii || candidate.domain || "");
  if (!domain || !domain.includes(".")) return null;
  const [history, crawl] = await Promise.all([wayback(domain), commonCrawl(domain)]);
  return {
    ...candidate,
    domain,
    history,
    crawl,
    ...scoreCandidate(candidate, history, crawl),
  };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

export async function GET() {
  return Response.json({
    engine: "SEO_AGED_DOMAIN_HUNTER_V1",
    publicSources: { wayback: true, commonCrawl: true, aftermarketMajestic: true },
    providers: providerStatus(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { candidates?: Candidate[] };
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 30) : [];
    if (!candidates.length) return Response.json({ error: "Brak kandydatów do analizy." }, { status: 400 });
    const enriched = (await mapConcurrent(candidates, 5, enrich)).filter(Boolean).sort((a, b) => (b?.recognition || 0) - (a?.recognition || 0));
    return Response.json({
      engine: "SEO_AGED_DOMAIN_HUNTER_V1",
      providers: providerStatus(),
      analyzed: enriched.length,
      results: enriched,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "SEO Hunter failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
