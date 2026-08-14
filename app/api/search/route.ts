import { generateSmartNames } from "@/lib/ai-naming";
import { plFallbackPricing, usdToPlnRate } from "@/lib/domain-commerce";
import { calculateRetailPrice, isDynadotConfigured, searchDynadotDomains } from "@/lib/dynadot";
import { checkDomain } from "@/lib/rdap";
import { reasonForCandidate, scoreCandidate } from "@/lib/scoring";
import { clampSettings, type RadarSettings } from "@/lib/settings";
import type { DomainResult, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const DEFAULT_TLD = "pl";
const MAX_NAMES = 100;
const CONCURRENCY = 16;

function frame(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function cleanLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function POST(request: Request) {
  let body: { prompt?: string; limit?: number; tld?: string; exclude?: string[]; batch?: number; settings?: Partial<RadarSettings> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  if (prompt.length < 1 || prompt.length > 500) {
    return Response.json({ error: "Prompt must contain 1-500 characters." }, { status: 400 });
  }

  const settings = clampSettings(body.settings);
  const limit = Math.max(10, Math.min(Number(body.limit) || 100, MAX_NAMES));
  const tld = (body.tld || DEFAULT_TLD).replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9-]{2,24}$/.test(tld)) return Response.json({ error: "Invalid TLD" }, { status: 400 });

  const batch = Math.max(1, Math.min(Number(body.batch) || 1, 5));
  const exclude = Array.from(new Set((body.exclude ?? []).map(cleanLabel).filter(Boolean))).slice(0, 500);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(frame(event));
      const heartbeat = () => new Date().toISOString();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      try {
        send({ type: "status", stage: "analysis", progress: 5, message: `Partia ${batch}/5: analizuję QUERY i promień wyszukiwania dla .${tld}…`, heartbeat: heartbeat() });
        const generated = await generateSmartNames(prompt, limit, { exclude, tld, batch, settings });
        const names = generated.names.filter((name) => !exclude.includes(name)).slice(0, limit);
        send({
          type: "status",
          stage: "generation",
          progress: 18,
          message: `${generated.provider === "openai" ? "AI" : "Silnik lokalny"} (${generated.model}) przygotował ${names.length} nowych nazw — cykl ${batch}/5.`,
          heartbeat: heartbeat(),
        });

        const pairs = names.map((label) => ({ label, tld, domain: `${label}.${tld}` }));
        const results: DomainResult[] = [];
        let checked = 0;
        let nextIndex = 0;
        let lastActivity = Date.now();

        const dynadotEnabled = isDynadotConfigured();
        send({
          type: "status",
          stage: "availability",
          progress: 20,
          message: dynadotEnabled
            ? `Sprawdzam ${pairs.length} domen przez Dynadot LIVE — dostępność i ceny z konta…`
            : `Sprawdzam ${pairs.length} domen przez RDAP — Dynadot czeka na klucz API…`,
          heartbeat: heartbeat(),
        });

        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastActivity < 2500) return;
          const progress = 20 + Math.round((checked / Math.max(1, pairs.length)) * 75);
          send({ type: "status", stage: "availability", progress, message: `Radar działa — partia ${batch}: ${checked}/${pairs.length}.`, heartbeat: heartbeat() });
          lastActivity = Date.now();
        }, 1000);

        let dynadotResults = new Map<string, Awaited<ReturnType<typeof searchDynadotDomains>> extends Map<string, infer T> ? T : never>();
        if (dynadotEnabled) {
          try {
            dynadotResults = await searchDynadotDomains(pairs.map((pair) => pair.domain));
            lastActivity = Date.now();
            send({
              type: "status",
              stage: "availability",
              progress: 28,
              message: `Dynadot LIVE odpowiedział dla ${dynadotResults.size}/${pairs.length} domen. Braki sprawdzę przez RDAP.`,
              heartbeat: heartbeat(),
            });
          } catch (error) {
            lastActivity = Date.now();
            send({
              type: "status",
              stage: "availability",
              progress: 24,
              message: `Dynadot niedostępny (${error instanceof Error ? error.message.slice(0, 90) : "błąd API"}) — przełączam na RDAP.`,
              heartbeat: heartbeat(),
            });
          }
        }

        const needsUsdConversion = Array.from(dynadotResults.values()).some((item) => item.price?.currency?.toUpperCase() === "USD");
        const usdPln = needsUsdConversion ? await usdToPlnRate() : 1;
        const plFallback = tld === "pl" ? await plFallbackPricing() : null;

        async function worker() {
          while (true) {
            const index = nextIndex++;
            if (index >= pairs.length) return;
            const pair = pairs[index];
            const dynadot = dynadotResults.get(pair.domain);
            const fallback = dynadot ? null : await checkDomain(pair.domain);
            checked += 1;
            lastActivity = Date.now();
            const metrics = scoreCandidate(prompt, pair.label);

            const sourceCurrency = dynadot?.price?.currency?.toUpperCase() || "PLN";
            const conversion = sourceCurrency === "USD" ? usdPln : 1;
            let registrationPrice = dynadot?.price?.registrationPrice;
            let renewalPrice = dynadot?.price?.renewalPrice;
            let transferPrice = dynadot?.price?.transferPrice;
            let priceUnit = dynadot?.price?.unit;

            if (registrationPrice !== undefined && (sourceCurrency === "PLN" || sourceCurrency === "USD")) registrationPrice = roundMoney(registrationPrice * conversion);
            if (renewalPrice !== undefined && (sourceCurrency === "PLN" || sourceCurrency === "USD")) renewalPrice = roundMoney(renewalPrice * conversion);
            if (transferPrice !== undefined && (sourceCurrency === "PLN" || sourceCurrency === "USD")) transferPrice = roundMoney(transferPrice * conversion);

            if (pair.tld === "pl" && plFallback && registrationPrice === undefined) {
              registrationPrice = plFallback.registrationPrice;
              renewalPrice = plFallback.renewalPrice;
              transferPrice = plFallback.transferPrice;
              priceUnit = plFallback.unit;
            }

            const canPriceInPln = sourceCurrency === "PLN" || sourceCurrency === "USD" || pair.tld === "pl";
            const retailPrice = canPriceInPln ? calculateRetailPrice(registrationPrice) : undefined;
            const renewalRetailPrice = canPriceInPln ? calculateRetailPrice(renewalPrice) : undefined;
            const transferRetailPrice = canPriceInPln ? calculateRetailPrice(transferPrice) : undefined;

            const result: DomainResult = {
              ...pair,
              state: dynadot?.state ?? fallback?.state ?? "unknown",
              statusCode: fallback?.statusCode,
              ...metrics,
              sources: [generated.provider === "openai" ? "ai" : "deterministic", dynadot ? "dynadot" : "rdap"],
              reason: dynadot?.detailsError || fallback?.reason || reasonForCandidate(prompt, pair.label),
              premium: dynadot?.premium,
              currency: canPriceInPln && registrationPrice !== undefined ? "PLN" : dynadot?.price?.currency,
              priceUnit,
              registrationPrice,
              renewalPrice,
              transferPrice,
              retailPrice,
              renewalRetailPrice,
              transferRetailPrice,
            };
            results.push(result);
            send({ type: "candidate", result, checked, total: pairs.length, heartbeat: heartbeat() });
          }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pairs.length)) }, () => worker()));
        results.sort((a, b) => b.score - a.score || a.label.length - b.label.length || b.similarity - a.similarity || a.domain.localeCompare(b.domain));
        send({ type: "complete", results, checked, total: pairs.length, heartbeat: heartbeat() });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Search failed", heartbeat: heartbeat() });
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
