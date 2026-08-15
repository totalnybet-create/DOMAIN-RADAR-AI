import { getDomainQuote } from "@/lib/domain-commerce";
import { isDynadotRegistrationConfigured } from "@/lib/dynadot";
import {
  createHotPayOrder,
  createHotPayPayment,
  isHotPayConfigured,
  validateContact,
} from "@/lib/hotpay";
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
  const hotPayConfigured = isHotPayConfigured();
  const stripeConfigured = isStripeCheckoutConfigured() && isStripeWebhookConfigured();
  return Response.json(
    {
      checkoutConfigured: hotPayConfigured || stripeConfigured,
      webhookConfigured: hotPayConfigured || isStripeWebhookConfigured(),
      registrationConfigured: isDynadotRegistrationConfigured(),
      provider: hotPayConfigured ? "hotpay" : stripeConfigured ? "stripe" : null,
      providers: {
        hotpay: hotPayConfigured,
        stripe: stripeConfigured,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const hotPayConfigured = isHotPayConfigured();
  const stripeConfigured = isStripeCheckoutConfigured() && isStripeWebhookConfigured();
  if (!hotPayConfigured && !stripeConfigured) return Response.json({ error: "Płatności nie są jeszcze aktywne." }, { status: 503 });
  if (!isDynadotRegistrationConfigured()) return Response.json({ error: "Automatyczna rejestracja domen nie jest jeszcze aktywna." }, { status: 503 });

  let body: { domain?: string; contact?: unknown };
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

    if (hotPayConfigured) {
      const contact = validateContact(body.contact);
      if (!contact) {
        return Response.json(
          {
            error: "Uzupełnij dane właściciela domeny przed przejściem do płatności.",
            requiresContact: true,
            provider: "hotpay",
          },
          { status: 400 },
        );
      }

      const order = await createHotPayOrder({
        domain: quote.domain,
        amountPln: quote.retailPricePln,
        wholesalePrice: quote.wholesalePrice,
        wholesaleCurrency: quote.wholesaleCurrency,
        registrationYears: quote.registrationYears,
        premium: quote.premium,
        contact,
      });
      const url = await createHotPayPayment({
        reference: order.reference,
        domain: quote.domain,
        amountPln: quote.retailPricePln,
        origin: requestOrigin(request),
        contact,
      });

      return Response.json(
        {
          ok: true,
          provider: "hotpay",
          url,
          orderId: order.reference,
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
    }

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
        provider: "stripe",
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
