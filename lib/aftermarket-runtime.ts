import type { ExpiringDomain, MarketAuction } from "@/lib/aftermarket";
import { getAftermarketConfig } from "@/lib/aftermarket";
import { readAftermarketVault } from "@/lib/aftermarket-vault";

const BASE_URL = "https://json.aftermarket.pl";

type ApiEnvelope<T> = {
  ok?: number | boolean;
  status?: number;
  error?: string;
  errtype?: string;
  data?: T;
};

export type AftermarketRuntimeCredentials = {
  apiKey: string;
  apiPassword: string;
  source: "environment" | "vault";
};

export function resolveAftermarketCredentials(request?: Request): AftermarketRuntimeCredentials | null {
  const config = getAftermarketConfig();
  if (config.apiKey && config.apiPassword) {
    return { apiKey: config.apiKey, apiPassword: config.apiPassword, source: "environment" };
  }
  if (!request) return null;
  const stored = readAftermarketVault(request);
  if (!stored) return null;
  return { apiKey: stored.apiKey, apiPassword: stored.apiPassword, source: "vault" };
}

export function hasAftermarketCredentials(request?: Request) {
  return Boolean(resolveAftermarketCredentials(request));
}

async function callAftermarket<T>(
  credentials: Pick<AftermarketRuntimeCredentials, "apiKey" | "apiPassword">,
  path: string,
  params: Record<string, unknown>,
) {
  const authorization = Buffer.from(`${credentials.apiKey}:${credentials.apiPassword}`, "utf8").toString("base64");
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
    const error = new Error(payload.error || `AfterMarket API ${response.status}`);
    error.name = payload.errtype || "AfterMarketApiError";
    throw error;
  }
  return payload.data as T;
}

export async function testAftermarketCredentials(
  credentials: Pick<AftermarketRuntimeCredentials, "apiKey" | "apiPassword">,
) {
  const expiring = await callAftermarket<ExpiringDomain[]>(credentials, "/buyer/expiring/domain/list", {
    tld: "pl",
    noNumbers: true,
    noHyphens: true,
    idn: 2,
    premium: 0,
    future: 0,
    lengthFrom: 2,
    lengthTo: 14,
    order: "deleted",
    size: 1,
    start: 0,
  });
  const listings = await callAftermarket<MarketAuction[]>(credentials, "/listing/list", {
    tld: "pl",
    what: 2,
    noNumbers: true,
    noHyphens: true,
    noIDN: true,
    lengthFrom: 2,
    lengthTo: 14,
    currency: "PLN",
    order: "price",
    size: 1,
    start: 0,
  });
  return { expiring: Array.isArray(expiring), listings: Array.isArray(listings) };
}

export async function listExpiringPlRuntime(
  credentials: Pick<AftermarketRuntimeCredentials, "apiKey" | "apiPassword">,
  options?: {
    size?: number;
    start?: number;
    maxLength?: number;
    minAge?: number;
    minMajesticQuality?: number;
    qualityPrefilter?: boolean;
    order?: "name" | "deleted" | "archive" | "created" | "expires" | "age" | "majesticLinks" | "majesticDomains" | "majesticQuality";
  },
) {
  const qualityPrefilter = options?.qualityPrefilter !== false;
  return callAftermarket<ExpiringDomain[]>(credentials, "/buyer/expiring/domain/list", {
    tld: "pl",
    noNumbers: qualityPrefilter,
    noHyphens: qualityPrefilter,
    idn: 2,
    premium: 0,
    future: 0,
    lengthFrom: 2,
    lengthTo: Math.min(30, Math.max(3, options?.maxLength || 14)),
    age: Math.max(0, options?.minAge || 0),
    majesticQuality: Math.max(0, options?.minMajesticQuality || 0),
    order: options?.order || "deleted",
    size: Math.min(5000, Math.max(1, options?.size || 500)),
    start: Math.max(0, Math.floor(options?.start || 0)),
  });
}

export async function listPlAuctionsRuntime(
  credentials: Pick<AftermarketRuntimeCredentials, "apiKey" | "apiPassword">,
  options?: {
    size?: number;
    start?: number;
    maxLength?: number;
    maxPrice?: number;
    qualityPrefilter?: boolean;
    order?: "name" | "endtime" | "price" | "offers" | "length" | "views";
  },
) {
  const config = getAftermarketConfig();
  const requestedSize = Math.min(5000, Math.max(1, options?.size || 500));
  const perKind = Math.min(1250, Math.max(100, Math.ceil(requestedSize / 4)));
  const maxLength = Math.min(30, Math.max(3, options?.maxLength || 14));
  const maxPrice = Math.max(1, options?.maxPrice || config.maxDomainPrice);
  const globalStart = Math.max(0, Math.floor(options?.start || 0));
  const perKindStart = Math.floor(globalStart / 4);
  const qualityPrefilter = options?.qualityPrefilter !== false;
  const kinds = [
    { what: 2, kind: "auction" as const },
    { what: 3, kind: "last-minute" as const },
    { what: 4, kind: "caught" as const },
    { what: 5, kind: "cheap" as const },
  ];

  const groups = await Promise.all(
    kinds.map(async ({ what, kind }) => {
      const items = await callAftermarket<MarketAuction[]>(credentials, "/listing/list", {
        tld: "pl",
        what,
        noNumbers: qualityPrefilter,
        noHyphens: qualityPrefilter,
        noIDN: true,
        lengthFrom: 2,
        lengthTo: maxLength,
        priceTo: maxPrice,
        currency: "PLN",
        order: options?.order || "price",
        size: perKind,
        start: perKindStart,
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
