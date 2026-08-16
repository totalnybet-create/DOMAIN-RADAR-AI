import { getAftermarketConfig } from "@/lib/aftermarket";
import { resolveAftermarketCredentials } from "@/lib/aftermarket-runtime";
import { readAftermarketVault } from "@/lib/aftermarket-vault";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getAftermarketConfig();
  const credentials = resolveAftermarketCredentials(request);
  const vault = readAftermarketVault(request);
  return Response.json(
    {
      connected: Boolean(credentials),
      connectionSource: credentials?.source || null,
      keyName: vault?.keyName || (credentials?.source === "environment" ? "Environment key" : null),
      autoRepairReady: Boolean(vault?.account?.login && vault?.account?.password),
      executionEnabled: config.executionEnabled,
      limits: {
        minScore: config.minScore,
        maxDomainPrice: config.maxDomainPrice,
        maxDailyBudget: config.maxDailyBudget,
      },
      provider: "AfterMarket.pl",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
