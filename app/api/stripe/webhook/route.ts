import { getDomainQuote, privacyForDomain } from "@/lib/domain-commerce";
import { registerDynadotDomain, type DynadotContact } from "@/lib/dynadot";
import {
  paymentIntentId,
  refundPaymentIntent,
  retrieveCheckoutSession,
  updateCheckoutSessionMetadata,
  verifyStripeWebhook,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHONE_CC: Record<string, string> = {
  PL: "48", DE: "49", CZ: "420", SK: "421", GB: "44", IE: "353", FR: "33", ES: "34", IT: "39",
  NL: "31", BE: "32", AT: "43", CH: "41", PT: "351", SE: "46", NO: "47", DK: "45", FI: "358",
  LT: "370", LV: "371", EE: "372", HU: "36", RO: "40", BG: "359", GR: "30", US: "1", CA: "1",
};

function contactFromSession(session: Awaited<ReturnType<typeof retrieveCheckoutSession>>): DynadotContact | null {
  const details = session.customer_details;
  const address = details?.address;
  const country = address?.country?.toUpperCase() || "";
  const phoneCc = PHONE_CC[country] || "";
  const rawPhone = (details?.phone || "").replace(/[^0-9+]/g, "");
  let phoneNumber = rawPhone.replace(/^\+/, "");
  if (phoneCc && phoneNumber.startsWith(phoneCc)) phoneNumber = phoneNumber.slice(phoneCc.length);

  if (!details?.name || !details.email || !phoneCc || !phoneNumber || !address?.line1 || !address.city || !address.postal_code || !country) {
    return null;
  }

  return {
    name: details.name,
    email: details.email,
    phoneCc,
    phoneNumber,
    address1: address.line1,
    address2: address.line2 || undefined,
    city: address.city,
    state: address.state || undefined,
    postalCode: address.postal_code,
    country,
  };
}

async function mark(sessionId: string, status: string, extra: Record<string, string> = {}) {
  return updateCheckoutSessionMetadata(sessionId, {
    registration_status: status,
    registration_updated_at: new Date().toISOString(),
    ...extra,
  });
}

async function safeRefund(session: Awaited<ReturnType<typeof retrieveCheckoutSession>>, status: string) {
  const paymentIntent = paymentIntentId(session);
  if (!paymentIntent) {
    await mark(session.id, "registration_review", { registration_error: "missing_payment_intent" });
    return;
  }
  const refund = await refundPaymentIntent(paymentIntent);
  await mark(session.id, status, { refund_id: refund.id });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let event;
  try {
    event = verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid webhook" }, { status: 400 });
  }

  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return Response.json({ received: true, ignored: true });
  }

  try {
    const session = await retrieveCheckoutSession(event.data.object.id);
    if (session.payment_status !== "paid") return Response.json({ received: true, waitingForPayment: true });

    const currentStatus = session.metadata?.registration_status || "pending";
    if (["registered", "registering", "registration_review", "refunded_unavailable", "refunded_price_changed"].includes(currentStatus)) {
      return Response.json({ received: true, idempotent: true, registrationStatus: currentStatus });
    }

    const domain = session.metadata?.domain?.trim().toLowerCase() || "";
    if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(domain)) {
      await mark(session.id, "registration_review", { registration_error: "invalid_domain_metadata" });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }

    const quote = await getDomainQuote(domain);
    if (quote.state !== "available") {
      await safeRefund(session, "refunded_unavailable");
      return Response.json({ received: true, registrationStatus: "refunded_unavailable" });
    }

    const paidPln = (session.amount_total || 0) / 100;
    if (quote.retailPricePln > paidPln + 0.01) {
      await safeRefund(session, "refunded_price_changed");
      return Response.json({ received: true, registrationStatus: "refunded_price_changed" });
    }

    const contact = contactFromSession(session);
    if (!contact) {
      await mark(session.id, "registration_review", { registration_error: "incomplete_contact_data" });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }

    await mark(session.id, "registering");
    try {
      await registerDynadotDomain(domain, {
        duration: quote.registrationYears,
        allowPremium: quote.premium,
        privacy: privacyForDomain(domain),
        contact,
      });
      await mark(session.id, "registered", { registered_domain: domain });
      return Response.json({ received: true, registrationStatus: "registered", domain });
    } catch (error) {
      // The registrar request can be ambiguous after a network failure. Do not auto-refund here,
      // because the domain may already have been registered. Flag it for review instead.
      await mark(session.id, "registration_review", {
        registration_error: (error instanceof Error ? error.message : "registration_failed").slice(0, 450),
      });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Webhook processing failed" }, { status: 500 });
  }
}
