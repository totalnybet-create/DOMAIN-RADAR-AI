export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "domain-radar-ai",
    version: "0.1.1",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    heartbeat: new Date().toISOString(),
  });
}
