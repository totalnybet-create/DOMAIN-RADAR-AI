import { generateNames, scoreDomain } from "@/lib/naming";
import { checkDomain } from "@/lib/rdap";
import type { DomainResult, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const DEFAULT_TLDS = ["pl", "com", "eu"];

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
      try {
        send({ type: "status", stage: "analysis", progress: 8, message: "Analizuję branżę i słownictwo…", heartbeat: heartbeat() });
        const names = generateNames(prompt, limit);
        send({ type: "status", stage: "generation", progress: 22, message: `Wygenerowano ${names.length} kandydatów marki.`, heartbeat: heartbeat() });

        const pairs = names.flatMap((label) => tlds.map((tld) => ({ label, tld, domain: `${label}.${tld}` })));
        const results: DomainResult[] = [];
        let checked = 0;
        send({ type: "status", stage: "availability", progress: 25, message: `Sprawdzam ${pairs.length} domen przez RDAP…`, heartbeat: heartbeat() });

        for (const pair of pairs) {
          const check = await checkDomain(pair.domain);
          checked += 1;
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

        results.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
        send({ type: "complete", results, checked, total: pairs.length, heartbeat: heartbeat() });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Search failed", heartbeat: heartbeat() });
      } finally {
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
