import { generateSmartNames } from "@/lib/ai-naming";
import { scoreDomain } from "@/lib/naming";
import { checkDomain } from "@/lib/rdap";
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
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
}

export async function POST(request: Request) {
  let body: { prompt?: string; limit?: number; tld?: string; exclude?: string[]; batch?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  if (prompt.length < 2 || prompt.length > 500) {
    return Response.json({ error: "Prompt must contain 2-500 characters." }, { status: 400 });
  }

  const limit = Math.max(10, Math.min(Number(body.limit) || 100, MAX_NAMES));
  const tld = (body.tld || DEFAULT_TLD).replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9-]{2,24}$/.test(tld)) {
    return Response.json({ error: "Invalid TLD" }, { status: 400 });
  }

  const batch = Math.max(1, Math.min(Number(body.batch) || 1, 5));
  const exclude = Array.from(new Set((body.exclude ?? []).map(cleanLabel).filter(Boolean))).slice(0, 500);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(frame(event));
      const heartbeat = () => new Date().toISOString();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      try {
        send({ type: "status", stage: "analysis", progress: 5, message: `Partia ${batch}/5: analizuję słowo i bliskie warianty dla .${tld}…`, heartbeat: heartbeat() });
        const generated = await generateSmartNames(prompt, limit, { exclude, tld, batch });
        const names = generated.names.filter((name) => !exclude.includes(name)).slice(0, limit);
        send({
          type: "status",
          stage: "generation",
          progress: 18,
          message: generated.provider === "openai" ? `AI przygotowało ${names.length} nowych nazw w partii ${batch}.` : `Generator przygotował ${names.length} nowych nazw w partii ${batch}.`,
          heartbeat: heartbeat(),
        });

        const pairs = names.map((label) => ({ label, tld, domain: `${label}.${tld}` }));
        const results: DomainResult[] = [];
        let checked = 0;
        let nextIndex = 0;
        let lastActivity = Date.now();

        send({ type: "status", stage: "availability", progress: 20, message: `Sprawdzam ${pairs.length} nowych domen .${tld}…`, heartbeat: heartbeat() });

        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastActivity < 2500) return;
          const progress = 20 + Math.round((checked / Math.max(1, pairs.length)) * 75);
          send({
            type: "status",
            stage: "availability",
            progress,
            message: `Radar działa — partia ${batch}: ${checked}/${pairs.length}.`,
            heartbeat: heartbeat(),
          });
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
            const result: DomainResult = {
              ...pair,
              state: check.state,
              statusCode: check.statusCode,
              reason: check.reason,
              score: scoreDomain(pair.label, pair.tld, check.state),
            };
            results.push(result);
            send({ type: "candidate", result, checked, total: pairs.length, heartbeat: heartbeat() });
          }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pairs.length)) }, () => worker()));
        results.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
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
