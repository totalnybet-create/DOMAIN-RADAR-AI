export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "domain-radar-ai",
    version: "0.1.0",
    heartbeat: new Date().toISOString(),
  });
}
