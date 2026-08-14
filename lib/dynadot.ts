import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { DomainState } from "@/lib/types";

const BASE_URL = "https://api.dynadot.com";
const DEFAULT_CURRENCY = "PLN";
const DEFAULT_BULK_SIZE = 5;
const DEFAULT_INTERVAL_MS = 1050;

export type DynadotPrice = {
  currency: string;
  unit?: string;
  registrationPrice?: number;
  renewalPrice?: number;
  transferPrice?: number;
  restorePrice?: number;
};

export type DynadotSearchResult = {
  domain: string;
  state: DomainState;
  premium?: boolean;
  price?: DynadotPrice;
  retailPrice?: number;
  detailsError?: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function pick(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toYesNo(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampFloat(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function getDynadotConfig() {
  return {
    apiKey: process.env.DYNADOT_API_KEY?.trim() || "",
    apiSecret: process.env.DYNADOT_API_SECRET?.trim() || "",
    currency: (process.env.DYNADOT_CURRENCY?.trim() || DEFAULT_CURRENCY).toUpperCase(),
    bulkSize: clampInt(process.env.DYNADOT_BULK_SIZE, DEFAULT_BULK_SIZE, 1, 20),
    intervalMs: clampInt(process.env.DYNADOT_REQUEST_INTERVAL_MS, DEFAULT_INTERVAL_MS, 0, 5000),
    markupPercent: clampFloat(process.env.DYNADOT_MARKUP_PERCENT, 0, 0, 500),
    markupFixed: clampFloat(process.env.DYNADOT_MARKUP_FIXED, 0, 0, 100000),
    registrationEnabled: process.env.DYNADOT_REGISTRATION_ENABLED === "true",
    registrationToken: process.env.DOMAIN_RADAR_REGISTRATION_TOKEN?.trim() || "",
  };
}

export function isDynadotConfigured() {
  return Boolean(getDynadotConfig().apiKey);
}

export function isDynadotRegistrationConfigured() {
  const config = getDynadotConfig();
  return Boolean(config.apiKey && config.apiSecret && config.registrationEnabled && config.registrationToken);
}

export function calculateRetailPrice(cost: number | undefined) {
  if (cost === undefined) return undefined;
  const { markupPercent, markupFixed } = getDynadotConfig();
  return Math.round((cost * (1 + markupPercent / 100) + markupFixed) * 100) / 100;
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function parsePrice(rawValue: unknown): DynadotPrice | undefined {
  const rawList = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
  if (!rawList.length) return undefined;
  const rows = rawList.map(asRecord);
  const row = rows.find((item) => String(pick(item, "unit", "Unit") || "").includes("1 year")) || rows[0];
  const registrationPrice = toNumber(pick(row, "registration_price", "registrationPrice", "RegistrationPrice"));
  const renewalPrice = toNumber(pick(row, "renewal_price", "renewalPrice", "RenewalPrice"));
  const transferPrice = toNumber(pick(row, "transfer_price", "transferPrice", "TransferPrice"));
  const restorePrice = toNumber(pick(row, "restore_price", "restorePrice", "RestorePrice"));
  const currency = String(pick(row, "currency", "Currency") || getDynadotConfig().currency).toUpperCase();
  const unit = pick(row, "unit", "Unit");
  return {
    currency,
    unit: typeof unit === "string" ? unit : undefined,
    registrationPrice,
    renewalPrice,
    transferPrice,
    restorePrice,
  };
}

function parseSearchItem(value: unknown): DynadotSearchResult | null {
  const item = asRecord(value);
  const domain = String(pick(item, "domain_name", "domainName", "DomainName") || "").toLowerCase();
  if (!domain) return null;
  const available = toYesNo(pick(item, "available", "Available"));
  const premium = toYesNo(pick(item, "premium", "Premium"));
  const price = parsePrice(pick(item, "price_list", "priceList", "PriceList"));
  const detailsError = pick(item, "details_error_message", "detailsErrorMessage", "DetailsErrorMessage");
  return {
    domain,
    state: available === true ? "available" : available === false ? "registered" : "unknown",
    premium,
    price,
    retailPrice: calculateRetailPrice(price?.registrationPrice),
    detailsError: typeof detailsError === "string" ? detailsError : undefined,
  };
}

async function fetchBulkChunk(domains: string[]): Promise<DynadotSearchResult[]> {
  const config = getDynadotConfig();
  const url = new URL("/restful/v2/domains/bulk_search", BASE_URL);
  url.searchParams.set("domain_name_list", domains.join(","));
  url.searchParams.set("show_price", "true");
  url.searchParams.set("currency", config.currency.toLowerCase());

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      cache: "no-store",
    });
    if (response.status !== 429) break;
    await sleep(Math.max(1100, config.intervalMs));
  }

  if (!response?.ok) {
    const body = await response?.text().catch(() => "");
    throw new Error(`Dynadot API ${response?.status || 500}: ${body?.slice(0, 220) || "request failed"}`);
  }

  const payload = asRecord(await response.json());
  const data = asRecord(pick(payload, "data", "Data"));
  const list = pick(data, "domain_result_list", "domainResultList", "DomainResultList");
  const rows = Array.isArray(list) ? list : [];
  return rows.map(parseSearchItem).filter((item): item is DynadotSearchResult => Boolean(item));
}

export async function searchDynadotDomains(domains: string[]) {
  const config = getDynadotConfig();
  if (!config.apiKey) throw new Error("DYNADOT_API_KEY is not configured");
  const clean = Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
  const output = new Map<string, DynadotSearchResult>();
  for (let index = 0; index < clean.length; index += config.bulkSize) {
    const chunk = clean.slice(index, index + config.bulkSize);
    const rows = await fetchBulkChunk(chunk);
    for (const row of rows) output.set(row.domain, row);
    if (index + config.bulkSize < clean.length) await sleep(config.intervalMs);
  }
  return output;
}

function signature(apiKey: string, apiSecret: string, fullPathAndQuery: string, requestId: string, requestBody: string) {
  const stringToSign = `${apiKey}\n${fullPathAndQuery}\n${requestId}\n${requestBody}`;
  return createHmac("sha256", Buffer.from(apiSecret, "utf8")).update(Buffer.from(stringToSign, "utf8")).digest("base64");
}

export function validateRegistrationToken(received: string | null) {
  const expected = getDynadotConfig().registrationToken;
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function registerDynadotDomain(domain: string, options?: { duration?: number; allowPremium?: boolean; privacy?: "off" | "partial" | "full" }) {
  const config = getDynadotConfig();
  if (!isDynadotRegistrationConfigured()) throw new Error("Dynadot registration is disabled or incomplete");
  const normalized = domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(normalized)) throw new Error("Invalid domain");

  const fullPath = `/restful/v2/domains/${encodeURIComponent(normalized)}/register`;
  const body = JSON.stringify({
    domain: { duration: Math.min(10, Math.max(1, options?.duration || 1)) },
    privacy: options?.privacy || "full",
    currency: config.currency.toLowerCase(),
    register_premium: options?.allowPremium === true,
  });
  const requestId = randomUUID();
  const xSignature = signature(config.apiKey, config.apiSecret, fullPath, requestId, body);
  const response = await fetch(new URL(fullPath, BASE_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "X-Request-ID": requestId,
      "X-Signature": xSignature,
    },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) throw new Error(`Dynadot register ${response.status}: ${JSON.stringify(payload).slice(0, 350)}`);
  return payload;
}
