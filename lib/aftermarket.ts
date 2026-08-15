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
  auctionId: number;
  bids?: number;
  catch?: boolean;
  currency?: string;
  endtime?: number;
  minBid?: number;
  name: string;
  nameIDN?: string;
  price?: number;
  priceBuyNow?: number;
  priceStart?: number;
  status?: string;
  visits?: number;
  watched?: number;
};

type ApiEnvelope<T> = {
  ok?: number | boolean;
  status?: number;
  error?: string;
  errtype?: string;
  data?: T;
};

const STRONG_WORDS = new Set([
  "auto","bank","biznes","brylant","budowa","dom","domy","edukacja","energia","firma","finanse","gielda","hotel","hotele","inwestor","inwestycja","kancelaria","kapital","kasa","kredyt","kredyty","klinika","kurs","kursy","lekarz","luksus","media","mieszkanie","mieszkania","nieruchomosci","nocleg","noclegi","oferta","ogrod","palac","pieniadze","podatki","podatek","podroze","potega","praca","prawo","prestiz","rynek","samochod","samochody","skarb","sklep","sport","sprzedaz","sukces","szkolenia","technologia","ubezpieczenia","uroda","wakacje","wartosc","zamek","zdrowie","zloto"
]);

const SECONDARY_WORDS = new Set([
  "apartament","aukcja","centrum","cyfra","deweloper","dochod","dworek","ekspert","faktura","faktury","fundusz","gotowka","inwestycje","jezioro","kierunek","kuchnia","kwiaty","majatek","morze","muzyka","nauka","notariusz","okazja","palacyk","portfel","rezydencja","roslina","szczyt","turystyka","urlop","wygrana","wyspa","zamczysko"
]);

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
    minScore: intEnv("PL_SNIPER_MIN_SCORE", 78, 0, 100),
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
    premium: 2,
    future: 2,
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
  return callAftermarket<MarketAuction[]>("/auction/list", {
    tld: "pl",
    noNumbers: true,
    noHyphens: true,
    noIDN: true,
    lengthFrom: 2,
    lengthTo: Math.min(30, Math.max(3, options?.maxLength || 14)),
    priceTo: Math.max(1, options?.maxPrice || getAftermarketConfig().maxDomainPrice),
    currency: "PLN",
    order: "price",
    size: Math.min(5000, Math.max(1, options?.size || 500)),
    start: 0,
  });
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

function baseNameScore(domain: string) {
  const label = normalizedLabel(domain);
  let score = 0;
  const length = label.length;

  if (length <= 3) score += 34;
  else if (length <= 4) score += 30;
  else if (length <= 5) score += 27;
  else if (length <= 6) score += 24;
  else if (length <= 8) score += 19;
  else if (length <= 10) score += 13;
  else if (length <= 12) score += 8;
  else score += 3;

  if (!label.includes("-")) score += 8;
  if (!/\d/.test(label)) score += 8;
  if (STRONG_WORDS.has(label)) score += 32;
  else if (SECONDARY_WORDS.has(label)) score += 20;

  // Łatwość wymowy / brak dziwnych zbitek.
  if (/[aeiouy]/.test(label)) score += 3;
  if (!/[bcdfghjklmnpqrstvwxyz]{5,}/.test(label)) score += 3;

  if (trademarkRisk(domain)) score -= 60;
  return score;
}

export function scoreExpiring(item: ExpiringDomain) {
  let score = baseNameScore(item.name);
  const now = Date.now() / 1000;
  const age = item.createdTime ? Math.max(0, (now - item.createdTime) / 31557600) : 0;

  if (age >= 15) score += 12;
  else if (age >= 10) score += 9;
  else if (age >= 5) score += 6;
  else if (age >= 2) score += 3;

  if (item.archive) score += 5;
  const tf = item.majesticQuality || 0;
  if (tf >= 30) score += 14;
  else if (tf >= 20) score += 10;
  else if (tf >= 10) score += 5;

  const refs = item.majesticDomains || 0;
  if (refs >= 100) score += 9;
  else if (refs >= 30) score += 6;
  else if (refs >= 10) score += 3;

  if (item.premium) score -= 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreAuction(item: MarketAuction) {
  let score = baseNameScore(item.name);
  const bids = item.bids || 0;
  const watched = item.watched || 0;
  const visits = item.visits || 0;

  if (bids >= 5) score += 8;
  else if (bids >= 2) score += 4;
  if (watched >= 5) score += 7;
  else if (watched >= 2) score += 3;
  if (visits >= 100) score += 5;
  else if (visits >= 20) score += 2;
  if (item.catch) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function domainAgeYears(createdTime?: number) {
  return createdTime ? Math.max(0, Math.floor((Date.now() / 1000 - createdTime) / 31557600)) : undefined;
}
