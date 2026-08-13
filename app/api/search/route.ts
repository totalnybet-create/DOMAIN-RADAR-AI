import { generateNames, scoreDomain } from "@/lib/naming";
import { checkDomain } from "@/lib/rdap";
import type { DomainResult, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const DEFAULT_TLDS = ["pl", "com", "eu"];
const MAX_PAIRS = 80;
const CONCURRENCY = 8;

function frame(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request) {
  let body: { prompt?: string; limit?: number; tlds?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  if (prompt.length < 3 || prompt.length > 500) {
    return Response.json({ error: "Prompt must contain 3-500 characters." }, { status: 400 });
  }

  const limit = Math.max(3, Math.min(Number(body.limit) || 12, 20));
  const tlds = (body.tlds?.length ? body.tlds : DEFAULT_TLDS)
    .map((tld) => tld.replace(/^\./, "").toLowerCase())
    .filter((tld) => /^[a-z0-9-]{2,24}$/.test(tld))
    .slice(0, 6);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(frame(event));
      const heartbeat = () => new Date().toISOString();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      try {
        send({ type: "status", stage: "analysis", progress: 8, message: "Analizuję branżę i słownictwo…", heartbeat: heartbeat() });
        const names = generateNames(prompt, limit);
        send({ type: "status", stage: "generation", progress: 22, message: `Wygenerowano ${names.length} kandydatów marki.`, heartbeat: heartbeat() });

        const pairs = names
          .flatMap((label) => tlds.map((tld) => ({ label, tld, domain: `${label}.${tld}` })))
          .slice(0, MAX_PAIRS);
        const results: DomainResult[] = [];
        let checked = 0;
        let nextIndex = 0;
        let lastActivity = Date.now();

        send({ type: "status", stage: "availability", progress: 25, message: `Sprawdzam ${pairs.length} domen przez RDAP…`, heartbeat: heartbeat() });

        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastActivity < 2500) return;
          const progress = 25 + Math.round((checked / Math.max(1, pairs.length)) * 70);
          send({
            type: "status",
            stage: "availability",
            progress,
            message: `Radar działa — sprawdzono ${checked}/${pairs.length}.`,
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

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, () => worker()));
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
