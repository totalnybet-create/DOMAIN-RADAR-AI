import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id?: string } | null;
  customer_details?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: StripeAddress | null;
  } | null;
  metadata?: Record<string, string> | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession };
};

export function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || "",
  };
}

export function isStripeCheckoutConfigured() {
  return Boolean(getStripeConfig().secretKey);
}

export function isStripeWebhookConfigured() {
  const config = getStripeConfig();
  return Boolean(config.secretKey && config.webhookSecret);
}

async function stripeRequest<T>(path: string, init?: { method?: "GET" | "POST"; form?: URLSearchParams; idempotencyKey?: string }) {
  const { secretKey } = getStripeConfig();
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init?.form,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe API ${response.status}`);
  return payload;
}

export async function createDomainCheckoutSession(input: {
  domain: string;
  retailPricePln: number;
  wholesalePrice: number;
  wholesaleCurrency: string;
  registrationYears: number;
  premium: boolean;
  origin: string;
}) {
  const amount = Math.round(input.retailPricePln * 100);
  if (!Number.isFinite(amount) || amount < 100) throw new Error("Invalid checkout amount");

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("locale", "pl");
  form.set("customer_creation", "always");
  form.set("billing_address_collection", "required");
  form.set("phone_number_collection[enabled]", "true");
  form.set("success_url", `${input.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${input.origin}/?checkout=cancelled`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "pln");
  form.set("line_items[0][price_data][unit_amount]", String(amount));
  form.set("line_items[0][price_data][product_data][name]", `Rejestracja domeny ${input.domain}`);
  form.set("line_items[0][price_data][product_data][description]", `${input.registrationYears} ${input.registrationYears === 1 ? "rok" : "lata"} rejestracji domeny`);
  form.set("client_reference_id", input.domain);
  form.set("metadata[domain]", input.domain);
  form.set("metadata[retail_price_pln]", input.retailPricePln.toFixed(2));
  form.set("metadata[wholesale_price]", input.wholesalePrice.toFixed(4));
  form.set("metadata[wholesale_currency]", input.wholesaleCurrency.toUpperCase());
  form.set("metadata[registration_years]", String(input.registrationYears));
  form.set("metadata[premium]", input.premium ? "true" : "false");
  form.set("metadata[registration_status]", "pending");
  form.set("payment_intent_data[metadata][domain]", input.domain);
  form.set("payment_intent_data[metadata][registration_status]", "pending");

  return stripeRequest<StripeCheckoutSession>("/checkout/sessions", {
    method: "POST",
    form,
    idempotencyKey: `domain-checkout:${input.domain}:${amount}:${input.registrationYears}`,
  });
}

export async function retrieveCheckoutSession(sessionId: string) {
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid checkout session id");
  return stripeRequest<StripeCheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export async function updateCheckoutSessionMetadata(sessionId: string, metadata: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) form.set(`metadata[${key}]`, value);
  return stripeRequest<StripeCheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    form,
    idempotencyKey: `domain-session-meta:${sessionId}:${metadata.registration_status || "update"}`,
  });
}

export async function refundPaymentIntent(paymentIntentId: string, reason = "requested_by_customer") {
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) throw new Error("Invalid payment intent id");
  const form = new URLSearchParams();
  form.set("payment_intent", paymentIntentId);
  form.set("reason", reason);
  return stripeRequest<{ id: string; status?: string }>("/refunds", {
    method: "POST",
    form,
    idempotencyKey: `domain-refund:${paymentIntentId}`,
  });
}

export function paymentIntentId(session: StripeCheckoutSession) {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
}

export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null) {
  const { webhookSecret } = getStripeConfig();
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");

  const pieces = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = pieces.find((part) => part.startsWith("t="))?.slice(2) || "";
  const signatures = pieces.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) throw new Error("Stripe webhook timestamp outside tolerance");

  const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const expected = Buffer.from(digest, "hex");
  const valid = signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!valid) throw new Error("Invalid Stripe webhook signature");

  return JSON.parse(rawBody) as StripeEvent;
}
