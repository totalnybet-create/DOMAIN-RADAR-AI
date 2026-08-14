import { getDynadotConfig, isDynadotConfigured, isDynadotRegistrationConfigured } from "@/lib/dynadot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getDynadotConfig();
  return Response.json(
    {
      configured: isDynadotConfigured(),
      registrationConfigured: isDynadotRegistrationConfigured(),
      currency: config.currency,
      bulkSize: config.bulkSize,
      requestIntervalMs: config.intervalMs,
      markupPercent: config.markupPercent,
      markupFixed: config.markupFixed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
