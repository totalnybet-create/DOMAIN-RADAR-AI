const BASE_URL = "https://json.aftermarket.pl";

export type ExpiringDomain = {
  archive?: string;
  created?: string;
  createdTime?: number;
  deleted?: string;
  deletedTime?: number;
  expires?: string;
  expiresTime?: number;
  future?: boolean;
  links?: number;
  majesticDomains?: number;
  majesticLinks?: number;
  majesticQuality?: number;
  name: string;
  nameIDN?: string;
  pages?: number;
  premium?: boolean;
  registrar?: string;
  string?: string;
  tld?: string;
};

export type MarketAuction = {
  auctionEndTime?: number;
  auctionId: number;
  auctionKind?: "auction" | "last-minute" | "caught" | "cheap";
  auctionPriceBuyNow?: number;
  auctionReserve?: boolean;
  currency?: string;
  featured?: boolean;
  homepage?: boolean;
  listingId?: number;
  name: string;
  nameIDN?: string;
  offers?: number;
  price?: number;
  priceMinimum?: number;
  saleType?: string;
  type?: string;
};

type ApiEnvelope<T> = {
  ok?: number | boolean;
  status?: number;
  error?: string;
  errtype?: string;
  data?: T;
};

export type SztosTier = "ABSOLUTNY SZTOS" | "PREMIUM" | "MOCNA" | "WATCH" | "ODRZUĆ";

export type ScoreBreakdown = {
  name: number;
  commercial: number;
  authority: number;
  market: number;
  value: number;
  penalties: number;
};

export type ScoreDetails = {
  score: number;
  tier: SztosTier;
  breakdown: ScoreBreakdown;
  reasons: string[];
  rejectedReason?: string;
  trademarkRisk: boolean;
};

const STRONG_WORDS = new Set([
  "auto","bank","biznes","brylant","budowa","dom","domy","edukacja","energia","firma","finanse","gielda","hotel","hotele","inwestor","inwestycja","kancelaria","kapital","kasa","kredyt","kredyty","klinika","kurs","kursy","lekarz","luksus","media","mieszkanie","mieszkania","nieruchomosci","nocleg","noclegi","oferta","ogrod","palac","pieniadze","podatki","podatek","podroze","potega","praca","prawo","prestiz","rynek","samochod","samochody","skarb","sklep","sport","sprzedaz","sukces","szkolenia","technologia","ubezpieczenia","uroda","wakacje","wartosc","zamek","zdrowie","zloto"
]);

const SECONDARY_WORDS = new Set([
  "apartament","aukcja","centrum","cyfra","deweloper","dochod","dworek","ekspert","faktura","faktury","fundusz","gotowka","inwestycje","jezioro","kierunek","kuchnia","kwiaty","majatek","morze","muzyka","nauka","notariusz","okazja","palacyk","portfel","rezydencja","roslina","szczyt","turystyka","urlop","wygrana","wyspa","zamczysko"
]);

const COMMERCIAL_STEMS = [
  "auto","bank","biznes","budow","dom","eduk","energi","finans","firma","hotel","inwest","kancelar","kapital","kredyt","kurs","lekar","med","mieszk","nieruchom","nocleg","ogrod","podat","podroz","praca","prawo","samoch","sklep","sport","techn","ubezpiecz","urod","wakac","zdrow","zlot"
];

// Tylko oczywiste przypadki. To nie zastępuje pełnego badania znaków towarowych.
const OBVIOUS_TRADEMARK_RISK = new Set([
  "adidas","allegro","amazon","apple","booking","coca-cola","facebook","ferrari","google","instagram","lego","mercedes","microsoft","netflix","nike","openai","pepsi","samsung","spotify","tesla","tiktok","uber","whatsapp","youtube"
]);

function intEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function floatEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function getAftermarketConfig() {
  return {
    apiKey: process.env.AFTERMARKET_API_KEY?.trim() || "",
    apiPassword: process.env.AFTERMARKET_API_PASSWORD?.trim() || "",
    executionEnabled: process.env.AFTERMARKET_EXECUTION_ENABLED === "true",
    maxDomainPrice: floatEnv("PL_SNIPER_MAX_DOMAIN_PRICE", 50, 1, 100000),
    maxDailyBudget: floatEnv("PL_SNIPER_MAX_DAILY_BUDGET", 300, 1, 1000000),
    minScore: intEnv("PL_SNIPER_MIN_SCORE", 88, 0, 100),
  };
}

export function isAftermarketConfigured() {
  const config = getAftermarketConfig();
  return Boolean(config.apiKey && config.apiPassword);
}

async function callAftermarket<T>(path: string, params: Record<string, unknown>) {
  const config = getAftermarketConfig();
  if (!config.apiKey || !config.apiPassword) throw new Error("AfterMarket API is not configured");

  const authorization = Buffer.from(`${config.apiKey}:${config.apiPassword}`, "utf8").toString("base64");
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  const ok = payload.ok === 1 || payload.ok === true;
  if (!response.ok || !ok) {
    throw new Error(payload.error || `AfterMarket API ${response.status}`);
  }
  return payload.data as T;
}

export async function listExpiringPl(options?: {
  size?: number;
  maxLength?: number;
  minAge?: number;
  minMajesticQuality?: number;
  order?: "name" | "deleted" | "archive" | "created" | "expires" | "age" | "majesticLinks" | "majesticDomains" | "majesticQuality";
}) {
  return callAftermarket<ExpiringDomain[]>("/buyer/expiring/domain/list", {
    tld: "pl",
    noNumbers: true,
    noHyphens: true,
    idn: 2,
    premium: 0,
    future: 0,
    lengthFrom: 2,
    lengthTo: Math.min(30, Math.max(3, options?.maxLength || 14)),
    age: Math.max(0, options?.minAge || 0),
    majesticQuality: Math.max(0, options?.minMajesticQuality || 0),
    order: options?.order || "deleted",
    size: Math.min(5000, Math.max(1, options?.size || 500)),
    start: 0,
  });
}

export async function listPlAuctions(options?: {
  size?: number;
  maxLength?: number;
  maxPrice?: number;
}) {
  const requestedSize = Math.min(5000, Math.max(1, options?.size || 500));
  const perKind = Math.min(1250, Math.max(100, Math.ceil(requestedSize / 4)));
  const maxLength = Math.min(30, Math.max(3, options?.maxLength || 14));
  const maxPrice = Math.max(1, options?.maxPrice || getAftermarketConfig().maxDomainPrice);
  const kinds = [
    { what: 2, kind: "auction" as const },
    { what: 3, kind: "last-minute" as const },
    { what: 4, kind: "caught" as const },
    { what: 5, kind: "cheap" as const },
  ];

  const groups = await Promise.all(
    kinds.map(async ({ what, kind }) => {
      const items = await callAftermarket<MarketAuction[]>("/listing/list", {
        tld: "pl",
        what,
        noNumbers: true,
        noHyphens: true,
        noIDN: true,
        lengthFrom: 2,
        lengthTo: maxLength,
        priceTo: maxPrice,
        currency: "PLN",
        order: "price",
        size: perKind,
        start: 0,
      });
      return items.map((item) => ({ ...item, auctionKind: kind }));
    }),
  );

  const deduped = new Map<string, MarketAuction>();
  for (const item of groups.flat()) {
    const key = item.auctionId ? `auction:${item.auctionId}` : `name:${item.name.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || (item.price ?? Infinity) < (existing.price ?? Infinity)) deduped.set(key, item);
  }

  return [...deduped.values()].slice(0, requestedSize);
}

function normalizedLabel(domain: string) {
  return domain
    .split(".")[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

export function trademarkRisk(domain: string) {
  return OBVIOUS_TRADEMARK_RISK.has(normalizedLabel(domain));
}

function rejectReason(domain: string) {
  const label = normalizedLabel(domain);
  if (trademarkRisk(domain)) return "oczywiste ryzyko znaku towarowego";
  if (label.length < 2) return "za krótka lub nieprawidłowa nazwa";
  if (label.length > 20) return "nazwa za długa dla profilu Snipera";
  if (/\d/.test(label)) return "cyfry obniżają jakość nazwy";
  if (label.includes("-")) return "myślnik obniża wartość premium";
  if (/(.)\1\1/.test(label)) return "podejrzane powtórzenie znaków";
  if (label.length > 4 && !/[aeiouy]/.test(label)) return "nazwa praktycznie niewymawialna";
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(label)) return "zbyt ciężka zbitka spółgłosek";
  return undefined;
}

function tierFor(score: number): SztosTier {
  if (score >= 95) return "ABSOLUTNY SZTOS";
  if (score >= 90) return "PREMIUM";
  if (score >= 85) return "MOCNA";
  if (score >= 78) return "WATCH";
  return "ODRZUĆ";
}

function nameQuality(domain: string, reasons: string[]) {
  const label = normalizedLabel(domain);
  const length = label.length;
  let score = 0;

  if (length <= 3) { score += 20; reasons.push("ultrakrótka nazwa"); }
  else if (length <= 4) { score += 18; reasons.push("bardzo krótka nazwa"); }
  else if (length <= 5) { score += 16; reasons.push("krótka nazwa"); }
  else if (length <= 6) score += 14;
  else if (length <= 8) score += 11;
  else if (length <= 10) score += 8;
  else if (length <= 12) score += 5;
  else score += 2;

  if (!label.includes("-")) score += 3;
  if (!/\d/.test(label)) score += 3;
  if (/[aeiouy]/.test(label)) score += 4;
  if (!/[bcdfghjklmnpqrstvwxyz]{4,}/.test(label)) score += 3;
  if (!/(.)\1\1/.test(label)) score += 2;

  return Math.min(35, score);
}

function commercialQuality(domain: string, reasons: string[]) {
  const label = normalizedLabel(domain);
  if (STRONG_WORDS.has(label)) {
    reasons.push("mocne słowo komercyjne");
    return 25;
  }
  if (SECONDARY_WORDS.has(label)) {
    reasons.push("dobre słowo generyczne");
    return 18;
  }

  const stems = COMMERCIAL_STEMS.filter((stem) => label.includes(stem));
  if (!stems.length) return 0;
  const unique = [...new Set(stems)];
  let score = Math.min(16, unique.length * 8);
  if (unique.some((stem) => label.startsWith(stem) || label.endsWith(stem))) score += 4;
  reasons.push(`komercyjny rdzeń: ${unique.slice(0, 2).join("/")}`);
  return Math.min(25, score);
}

function blankBreakdown(): ScoreBreakdown {
  return { name: 0, commercial: 0, authority: 0, market: 0, value: 0, penalties: 0 };
}

export function scoreExpiringDetailed(item: ExpiringDomain): ScoreDetails {
  const reasons: string[] = [];
  const breakdown = blankBreakdown();
  const rejectedReason = rejectReason(item.name);
  const risk = trademarkRisk(item.name);
  if (rejectedReason) {
    return { score: 0, tier: "ODRZUĆ", breakdown, reasons: [rejectedReason], rejectedReason, trademarkRisk: risk };
  }

  breakdown.name = nameQuality(item.name, reasons);
  breakdown.commercial = commercialQuality(item.name, reasons);

  const now = Date.now() / 1000;
  const age = item.createdTime ? Math.max(0, (now - item.createdTime) / 31557600) : 0;
  if (age >= 15) { breakdown.authority += 8; reasons.push("15+ lat historii"); }
  else if (age >= 10) { breakdown.authority += 6; reasons.push("10+ lat historii"); }
  else if (age >= 5) breakdown.authority += 4;
  else if (age >= 2) breakdown.authority += 2;

  if (item.archive) { breakdown.authority += 4; reasons.push("historia w archiwum"); }

  const tf = item.majesticQuality || 0;
  if (tf >= 30) { breakdown.authority += 10; reasons.push("Trust Flow 30+"); }
  else if (tf >= 20) { breakdown.authority += 8; reasons.push("Trust Flow 20+"); }
  else if (tf >= 10) breakdown.authority += 5;
  else if (tf >= 5) breakdown.authority += 2;

  const refs = item.majesticDomains || 0;
  if (refs >= 100) { breakdown.authority += 8; reasons.push("100+ domen linkujących"); }
  else if (refs >= 30) { breakdown.authority += 6; reasons.push("30+ domen linkujących"); }
  else if (refs >= 10) breakdown.authority += 3;
  else if (refs >= 3) breakdown.authority += 1;
  breakdown.authority = Math.min(30, breakdown.authority);

  const hoursToDrop = item.deletedTime ? (item.deletedTime - now) / 3600 : undefined;
  if (hoursToDrop !== undefined && hoursToDrop >= 0 && hoursToDrop <= 72) {
    breakdown.market += 5;
    reasons.push("drop w ciągu 72h");
  } else if (hoursToDrop !== undefined && hoursToDrop <= 168) {
    breakdown.market += 3;
  }
  if (item.future) { breakdown.market += 3; reasons.push("domena ma opcję"); }
  if ((item.pages || 0) >= 100) breakdown.market += 2;
  breakdown.market = Math.min(10, breakdown.market);

  if (item.premium) {
    breakdown.penalties -= 15;
    reasons.push("kara za status premium");
  }

  const raw = breakdown.name + breakdown.commercial + breakdown.authority + breakdown.market + breakdown.penalties;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, tier: tierFor(score), breakdown, reasons: reasons.slice(0, 6), trademarkRisk: risk };
}

export function scoreAuctionDetailed(item: MarketAuction, maxPrice = getAftermarketConfig().maxDomainPrice): ScoreDetails {
  const reasons: string[] = [];
  const breakdown = blankBreakdown();
  const rejectedReason = rejectReason(item.name);
  const risk = trademarkRisk(item.name);
  if (rejectedReason) {
    return { score: 0, tier: "ODRZUĆ", breakdown, reasons: [rejectedReason], rejectedReason, trademarkRisk: risk };
  }

  breakdown.name = nameQuality(item.name, reasons);
  breakdown.commercial = commercialQuality(item.name, reasons);

  const offers = item.offers || 0;
  if (offers >= 10) { breakdown.market += 12; reasons.push("10+ ofert na aukcji"); }
  else if (offers >= 5) { breakdown.market += 9; reasons.push("5+ ofert na aukcji"); }
  else if (offers >= 2) { breakdown.market += 6; reasons.push("rynek już licytuje"); }
  else if (offers >= 1) breakdown.market += 3;

  if (item.featured) breakdown.market += 3;
  if (item.homepage) breakdown.market += 2;
  if (item.auctionKind === "caught") { breakdown.market += 3; reasons.push("aukcja przechwyconej domeny"); }
  else if (item.auctionKind === "last-minute") breakdown.market += 2;
  else if (item.auctionKind === "cheap") { breakdown.market += 1; reasons.push("tania aukcja"); }
  breakdown.market = Math.min(20, breakdown.market);

  const price = item.price ?? item.priceMinimum ?? item.auctionPriceBuyNow;
  if (price !== undefined && maxPrice > 0) {
    const ratio = price / maxPrice;
    if (ratio <= 0.2) { breakdown.value = 20; reasons.push("cena ≤ 20% limitu"); }
    else if (ratio <= 0.4) { breakdown.value = 17; reasons.push("bardzo dobra cena"); }
    else if (ratio <= 0.6) breakdown.value = 14;
    else if (ratio <= 0.8) breakdown.value = 11;
    else if (ratio <= 1) breakdown.value = 8;
  }

  const raw = breakdown.name + breakdown.commercial + breakdown.market + breakdown.value + breakdown.penalties;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, tier: tierFor(score), breakdown, reasons: reasons.slice(0, 6), trademarkRisk: risk };
}

export function scoreExpiring(item: ExpiringDomain) {
  return scoreExpiringDetailed(item).score;
}

export function scoreAuction(item: MarketAuction, maxPrice?: number) {
  return scoreAuctionDetailed(item, maxPrice).score;
}

export function domainAgeYears(createdTime?: number) {
  return createdTime ? Math.max(0, Math.floor((Date.now() / 1000 - createdTime) / 31557600)) : undefined;
}
