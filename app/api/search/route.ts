import { generateContextAwareNames, isBusinessBrief } from "@/lib/conversational-naming";
import { reasonForContextualCandidate, scoreContextualCandidate } from "@/lib/contextual-scoring";
import { checkDomain } from "@/lib/rdap";
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
        const semanticMode = isBusinessBrief(prompt);
        send({
          type: "status",
          stage: "analysis",
          progress: 5,
          message: semanticMode
            ? `Partia ${batch}/5: rozumiem branżę, klientów i skojarzenia biznesowe dla .${tld}…`
            : `Partia ${batch}/5: analizuję QUERY i promień wyszukiwania dla .${tld}…`,
          heartbeat: heartbeat(),
        });

        const generated = await generateContextAwareNames(prompt, limit, { exclude, tld, batch, settings });
        const names = generated.names.filter((name) => !exclude.includes(name)).slice(0, limit);
        send({
          type: "status",
          stage: "generation",
          progress: 18,
          message: `${generated.provider === "openai" ? "AI" : "Silnik lokalny"} (${generated.model}) przygotował ${names.length} nowych nazw · tryb ${generated.mode === "business-brief" ? "BRANŻOWY" : "RADAR"} · cykl ${batch}/5.`,
          heartbeat: heartbeat(),
        });

        const pairs = names.map((label) => ({ label, tld, domain: `${label}.${tld}` }));
        const results: DomainResult[] = [];
        let checked = 0;
        let nextIndex = 0;
        let lastActivity = Date.now();

        send({ type: "status", stage: "availability", progress: 20, message: `Sprawdzam ${pairs.length} domen przez RDAP — bez zgadywania dostępności…`, heartbeat: heartbeat() });

        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastActivity < 2500) return;
          const progress = 20 + Math.round((checked / Math.max(1, pairs.length)) * 75);
          send({ type: "status", stage: "availability", progress, message: `Radar działa — partia ${batch}: ${checked}/${pairs.length}.`, heartbeat: heartbeat() });
          lastActivity = Date.now();
        }, 1000);

        async function worker() {
          while (true) {
            const index = nextIndex++;
            if (index >= pairs.length) return;
            const pair = pairs[index];
            const check = await checkDomain(pair.domain);
            checked += 1;
            lastActivity = Date.now();
            const metrics = scoreContextualCandidate(prompt, pair.label);
            const result: DomainResult = {
              ...pair,
              state: check.state,
              statusCode: check.statusCode,
              ...metrics,
              sources: [generated.provider === "openai" ? "ai" : "deterministic"],
              reason: check.reason || reasonForContextualCandidate(prompt, pair.label),
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
