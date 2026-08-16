import type { ExecutorProvider } from "@/lib/executor/fallback";

export const runtime = "nodejs";

const DEFAULT_ORDER: ExecutorProvider[] = ["native", "replit", "appdeploy", "yepcode"];

function parseOrder(): ExecutorProvider[] {
  const raw = process.env.EXECUTOR_PROVIDER_ORDER?.trim();
  if (!raw) return DEFAULT_ORDER;

  const allowed = new Set<ExecutorProvider>(DEFAULT_ORDER);
  const parsed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ExecutorProvider => allowed.has(value as ExecutorProvider));

  return parsed.length ? [...new Set(parsed)] : DEFAULT_ORDER;
}

function providerConfigured(provider: ExecutorProvider) {
  if (provider === "native") return true;
  if (provider === "replit") return Boolean(process.env.EXECUTOR_REPLIT_URL?.trim());
  if (provider === "appdeploy") return Boolean(process.env.EXECUTOR_APPDEPLOY_URL?.trim());
  if (provider === "yepcode") return Boolean(process.env.EXECUTOR_YEPCODE_URL?.trim());
  return false;
}

export async function GET() {
  const order = parseOrder();

  return Response.json(
    {
      ready: true,
      strategy: "sequential-fallback",
      continueAfterProviderFailure: true,
      stopOnlyFor: ["HUMAN_ACTION_REQUIRED", "explicit non-retryable failure"],
      providers: order.map((provider, index) => ({
        provider,
        priority: index + 1,
        configured: providerConfigured(provider),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
