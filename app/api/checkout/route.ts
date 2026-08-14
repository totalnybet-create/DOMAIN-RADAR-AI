import { getDomainQuote } from "@/lib/domain-commerce";
import { isDynadotRegistrationConfigured } from "@/lib/dynadot";
import { createDomainCheckoutSession, isStripeCheckoutConfigured, isStripeWebhookConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 30;

function requestOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET() {
  return Response.json(
    {
      checkoutConfigured: isStripeCheckoutConfigured(),
      webhookConfigured: isStripeWebhookConfigured(),
      registrationConfigured: isDynadotRegistrationConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isStripeCheckoutConfigured()) return Response.json({ error: "Płatności nie są jeszcze aktywne." }, { status: 503 });
  if (!isStripeWebhookConfigured()) return Response.json({ error: "Finalizacja płatności nie jest jeszcze aktywna." }, { status: 503 });
  if (!isDynadotRegistrationConfigured()) return Response.json({ error: "Automatyczna rejestracja domen nie jest jeszcze aktywna." }, { status: 503 });

  let body: { domain?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Nieprawidłowe dane zamówienia." }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase() || "";
  if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(domain)) return Response.json({ error: "Nieprawidłowa domena." }, { status: 400 });

  try {
    const quote = await getDomainQuote(domain);
    if (quote.state !== "available") return Response.json({ error: "Ta domena nie jest już dostępna." }, { status: 409 });

    const session = await createDomainCheckoutSession({
      domain: quote.domain,
      retailPricePln: quote.retailPricePln,
      wholesalePrice: quote.wholesalePrice,
      wholesaleCurrency: quote.wholesaleCurrency,
      registrationYears: quote.registrationYears,
      premium: quote.premium,
      origin: requestOrigin(request),
    });

    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return Response.json(
      {
        ok: true,
        url: session.url,
        sessionId: session.id,
        quote: {
          domain: quote.domain,
          price: quote.retailPricePln,
          currency: "PLN",
          registrationYears: quote.registrationYears,
          premium: quote.premium,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Nie udało się rozpocząć płatności." }, { status: 502 });
  }
}
