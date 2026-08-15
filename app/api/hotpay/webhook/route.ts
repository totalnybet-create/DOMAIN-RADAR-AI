import { getDomainQuote, privacyForDomain } from "@/lib/domain-commerce";
import { registerDynadotDomain } from "@/lib/dynadot";
import {
  getHotPayOrder,
  updateHotPayOrder,
  verifyHotPayNotification,
  type HotPayNotification,
} from "@/lib/hotpay";

export const runtime = "nodejs";
export const maxDuration = 60;

function asNotification(form: FormData): HotPayNotification {
  return {
    SEKRET: String(form.get("SEKRET") || ""),
    KWOTA: String(form.get("KWOTA") || ""),
    STATUS: String(form.get("STATUS") || ""),
    ID_ZAMOWIENIA: String(form.get("ID_ZAMOWIENIA") || ""),
    ID_PLATNOSCI: String(form.get("ID_PLATNOSCI") || ""),
    SECURE: String(form.get("SECURE") || "") || undefined,
    HASH: String(form.get("HASH") || ""),
  };
}

export async function POST(request: Request) {
  let values: HotPayNotification;
  try {
    values = asNotification(await request.formData());
    verifyHotPayNotification(values);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid HotPay notification" }, { status: 400 });
  }

  const reference = values.ID_ZAMOWIENIA;
  try {
    const order = await getHotPayOrder(reference);
    if (!order) return Response.json({ error: "Unknown order" }, { status: 404 });

    if (values.STATUS === "PENDING") {
      await updateHotPayOrder(reference, {
        paymentStatus: "pending",
        providerPaymentId: values.ID_PLATNOSCI,
        providerSecure: values.SECURE,
      });
      return Response.json({ received: true, paymentStatus: "pending" });
    }

    if (values.STATUS === "FAILURE") {
      await updateHotPayOrder(reference, {
        paymentStatus: "failed",
        providerPaymentId: values.ID_PLATNOSCI,
        providerSecure: values.SECURE,
      });
      return Response.json({ received: true, paymentStatus: "failed" });
    }

    if (values.STATUS !== "SUCCESS") {
      return Response.json({ received: true, ignored: true, status: values.STATUS });
    }

    const paidPln = Number(values.KWOTA.replace(",", "."));
    if (!Number.isFinite(paidPln) || Math.abs(paidPln - order.amountPln) > 0.01) {
      await updateHotPayOrder(reference, {
        paymentStatus: "paid",
        registrationStatus: "registration_review",
        providerPaymentId: values.ID_PLATNOSCI,
        providerSecure: values.SECURE,
        registrationError: "payment_amount_mismatch",
      });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }

    if (["registered", "registering", "registration_review"].includes(order.registrationStatus)) {
      return Response.json({ received: true, idempotent: true, registrationStatus: order.registrationStatus });
    }

    const quote = await getDomainQuote(order.domain);
    if (quote.state !== "available") {
      await updateHotPayOrder(reference, {
        paymentStatus: "paid",
        registrationStatus: "registration_review",
        providerPaymentId: values.ID_PLATNOSCI,
        providerSecure: values.SECURE,
        registrationError: "domain_unavailable_after_payment",
      });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }

    if (quote.retailPricePln > paidPln + 0.01) {
      await updateHotPayOrder(reference, {
        paymentStatus: "paid",
        registrationStatus: "registration_review",
        providerPaymentId: values.ID_PLATNOSCI,
        providerSecure: values.SECURE,
        registrationError: "price_changed_after_payment",
      });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }

    await updateHotPayOrder(reference, {
      paymentStatus: "paid",
      registrationStatus: "registering",
      providerPaymentId: values.ID_PLATNOSCI,
      providerSecure: values.SECURE,
    });

    try {
      await registerDynadotDomain(order.domain, {
        duration: quote.registrationYears,
        allowPremium: quote.premium,
        privacy: privacyForDomain(order.domain),
        contact: order.contact,
      });
      await updateHotPayOrder(reference, {
        paymentStatus: "paid",
        registrationStatus: "registered",
      });
      return Response.json({ received: true, registrationStatus: "registered", domain: order.domain });
    } catch (error) {
      await updateHotPayOrder(reference, {
        paymentStatus: "paid",
        registrationStatus: "registration_review",
        registrationError: (error instanceof Error ? error.message : "registration_failed").slice(0, 450),
      });
      return Response.json({ received: true, registrationStatus: "registration_review" });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "HotPay webhook processing failed" }, { status: 500 });
  }
}
