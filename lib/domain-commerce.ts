import { calculateRetailPrice, getDynadotConfig, searchDynadotDomains } from "@/lib/dynadot";
import { checkDomain } from "@/lib/rdap";
import type { DomainState } from "@/lib/types";

let fxCache: { value: number; expiresAt: number } | null = null;

function numberEnv(name: string) {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) ? value : undefined;
}

export async function usdToPlnRate() {
  if (fxCache && fxCache.expiresAt > Date.now()) return fxCache.value;
  const fallback = numberEnv("DYNADOT_USD_PLN_RATE") ?? 4;
  try {
    const response = await fetch("https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    const payload = (await response.json()) as { rates?: Array<{ mid?: number }> };
    const rate = Number(payload?.rates?.[0]?.mid);
    const value = Number.isFinite(rate) && rate > 0 ? rate : fallback;
    fxCache = { value, expiresAt: Date.now() + 60 * 60 * 1000 };
    return value;
  } catch {
    fxCache = { value: fallback, expiresAt: Date.now() + 10 * 60 * 1000 };
    return fallback;
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function registrationYearsForDomain(domain: string) {
  return domain.toLowerCase().endsWith(".ai") ? 2 : 1;
}

export function privacyForDomain(domain: string): "off" | "full" {
  return domain.toLowerCase().endsWith(".pl") ? "off" : "full";
}

export async function plFallbackPricing() {
  const rate = await usdToPlnRate();
  const configuredCurrency = (process.env.DYNADOT_PL_PRICE_CURRENCY || "PLN").toUpperCase();
  const configuredRegistration = numberEnv("DYNADOT_PL_REGISTRATION_PRICE");
  const configuredRenewal = numberEnv("DYNADOT_PL_RENEWAL_PRICE");
  const configuredTransfer = numberEnv("DYNADOT_PL_TRANSFER_PRICE");

  const toPln = (value: number | undefined, usdFallback: number) => {
    const source = value ?? usdFallback;
    return roundMoney(source * (configuredCurrency === "USD" || value === undefined ? rate : 1));
  };

  const registrationPrice = toPln(configuredRegistration, 5.54);
  const renewalPrice = toPln(configuredRenewal, 15.7);
  const transferPrice = toPln(configuredTransfer, 15.7);
  return {
    currency: "PLN",
    unit: "1 year",
    registrationPrice,
    renewalPrice,
    transferPrice,
    retailPrice: calculateRetailPrice(registrationPrice),
  };
}

export type DomainQuote = {
  domain: string;
  state: DomainState;
  premium: boolean;
  registrationYears: number;
  wholesalePrice: number;
  wholesaleCurrency: string;
  retailPricePln: number;
  renewalPricePln?: number;
  transferPricePln?: number;
  source: "dynadot" | "dynadot+rdap" | "pl-fallback";
};

export async function getDomainQuote(domainInput: string): Promise<DomainQuote> {
  const domain = domainInput.trim().toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(domain)) throw new Error("Invalid domain");

  const config = getDynadotConfig();
  const liveMap = await searchDynadotDomains([domain]);
  const live = liveMap.get(domain);
  let state: DomainState = live?.state || "unknown";
  let source: DomainQuote["source"] = "dynadot";

  if (state === "unknown") {
    const fallback = await checkDomain(domain);
    state = fallback.state;
    source = "dynadot+rdap";
  }

  let wholesalePrice = live?.price?.registrationPrice;
  let wholesaleCurrency = live?.price?.currency || config.currency;
  let renewalPrice = live?.price?.renewalPrice;
  let transferPrice = live?.price?.transferPrice;
  let retailPricePln = live?.retailPrice;

  if (domain.endsWith(".pl") && (wholesalePrice === undefined || retailPricePln === undefined)) {
    const fallback = await plFallbackPricing();
    wholesalePrice = fallback.registrationPrice;
    wholesaleCurrency = "PLN";
    renewalPrice = fallback.renewalPrice;
    transferPrice = fallback.transferPrice;
    retailPricePln = fallback.retailPrice;
    source = "pl-fallback";
  } else if (wholesalePrice !== undefined) {
    const factor = wholesaleCurrency.toUpperCase() === "USD" ? await usdToPlnRate() : 1;
    const wholesalePln = roundMoney(wholesalePrice * factor);
    wholesalePrice = wholesalePln;
    wholesaleCurrency = "PLN";
    renewalPrice = renewalPrice === undefined ? undefined : roundMoney(renewalPrice * factor);
    transferPrice = transferPrice === undefined ? undefined : roundMoney(transferPrice * factor);
    retailPricePln = calculateRetailPrice(wholesalePln);
  }

  if (wholesalePrice === undefined || retailPricePln === undefined) throw new Error("Registrar did not return a registration price");

  return {
    domain,
    state,
    premium: Boolean(live?.premium),
    registrationYears: registrationYearsForDomain(domain),
    wholesalePrice,
    wholesaleCurrency,
    retailPricePln,
    renewalPricePln: renewalPrice,
    transferPricePln: transferPrice,
    source,
  };
}
