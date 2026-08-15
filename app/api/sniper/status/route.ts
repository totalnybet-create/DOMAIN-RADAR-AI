import { getAftermarketConfig, isAftermarketConfigured } from "@/lib/aftermarket";

export const runtime = "nodejs";

export async function GET() {
  const config = getAftermarketConfig();
  return Response.json(
    {
      connected: isAftermarketConfigured(),
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
