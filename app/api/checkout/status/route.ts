import { retrieveCheckoutSession } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!sessionId) return Response.json({ error: "Brak identyfikatora płatności." }, { status: 400 });

  try {
    const session = await retrieveCheckoutSession(sessionId);
    return Response.json(
      {
        sessionId: session.id,
        paymentStatus: session.payment_status || "unknown",
        registrationStatus: session.metadata?.registration_status || "pending",
        domain: session.metadata?.domain || "",
        amountTotal: session.amount_total || 0,
        currency: (session.currency || "pln").toUpperCase(),
        email: session.customer_details?.email || "",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Nie udało się odczytać statusu." }, { status: 502 });
  }
}
