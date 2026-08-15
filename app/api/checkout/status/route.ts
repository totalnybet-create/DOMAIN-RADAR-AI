import { getHotPayOrder } from "@/lib/hotpay";
import { retrieveCheckoutSession } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "stripe";

  if (provider === "hotpay") {
    const orderId = url.searchParams.get("order_id") || "";
    if (!orderId) return Response.json({ error: "Brak identyfikatora zamówienia." }, { status: 400 });
    try {
      const order = await getHotPayOrder(orderId);
      if (!order) return Response.json({ error: "Nie znaleziono zamówienia." }, { status: 404 });
      return Response.json(
        {
          provider: "hotpay",
          sessionId: orderId,
          paymentStatus: order.paymentStatus,
          registrationStatus: order.registrationStatus,
          domain: order.domain,
          amountTotal: Math.round(order.amountPln * 100),
          currency: "PLN",
          email: order.contact.email,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Nie udało się odczytać statusu." }, { status: 502 });
    }
  }

  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId) return Response.json({ error: "Brak identyfikatora płatności." }, { status: 400 });

  try {
    const session = await retrieveCheckoutSession(sessionId);
    return Response.json(
      {
        provider: "stripe",
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
