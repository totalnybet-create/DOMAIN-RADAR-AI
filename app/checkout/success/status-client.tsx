"use client";

import { useEffect, useState } from "react";

type Status = {
  provider?: string;
  paymentStatus: string;
  registrationStatus: string;
  domain: string;
  amountTotal: number;
  currency: string;
  email: string;
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export default function CheckoutStatusClient({ provider, identifier }: { provider: "stripe" | "hotpay"; identifier: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const load = async () => {
      attempts += 1;
      try {
        const query = provider === "hotpay"
          ? `provider=hotpay&order_id=${encodeURIComponent(identifier)}`
          : `session_id=${encodeURIComponent(identifier)}`;
        const response = await fetch(`/api/checkout/status?${query}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Nie udało się sprawdzić zamówienia.");
        if (cancelled) return;
        setStatus(payload);
        setError("");
        const finished = ["registered", "registration_review", "refunded_unavailable", "refunded_price_changed"].includes(payload.registrationStatus);
        if (!finished && attempts < 20) timer = setTimeout(load, 2000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Nie udało się sprawdzić zamówienia.");
        if (attempts < 10) timer = setTimeout(load, 2500);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [identifier, provider]);

  if (!identifier) return <div className="checkoutNotice errorNotice">Brak identyfikatora płatności.</div>;
  if (error && !status) return <div className="checkoutNotice errorNotice">{error}</div>;
  if (!status) return <div className="checkoutNotice"><span className="checkoutSpinner" /> Sprawdzam płatność i rejestrację domeny…</div>;

  const registration = status.registrationStatus;
  const registered = registration === "registered";
  const refunded = registration.startsWith("refunded_");
  const review = registration === "registration_review";
  const paid = status.paymentStatus === "paid";

  let title = "Finalizuję zamówienie";
  let message = paid
    ? "Płatność została potwierdzona. Trwa finalna rejestracja domeny."
    : provider === "hotpay"
      ? "HotPay potwierdza płatność. Status odświeży się automatycznie."
      : "Stripe potwierdza płatność.";
  if (registered) {
    title = "Domena zarejestrowana";
    message = "Zakup został zakończony poprawnie. Domena została zarejestrowana na dane właściciela podane przed płatnością.";
  } else if (refunded) {
    title = "Płatność została zwrócona";
    message = registration === "refunded_unavailable"
      ? "Domena przestała być dostępna przed rejestracją, dlatego płatność została automatycznie zwrócona."
      : "Cena rejestracji zmieniła się przed finalizacją, dlatego płatność została automatycznie zwrócona.";
  } else if (review) {
    title = "Zamówienie wymaga weryfikacji";
    message = provider === "hotpay"
      ? "Płatność została potwierdzona, ale rejestracja wymaga ręcznej kontroli. System nie wykona drugi raz rejestracji automatycznie."
      : "Płatność jest zabezpieczona, ale rejestrator nie zwrócił jednoznacznego potwierdzenia. Zamówienie nie zostanie wykonane drugi raz automatycznie.";
  }

  return (
    <div className={`checkoutResult ${registered ? "success" : refunded || review ? "warning" : "processing"}`}>
      <div className="checkoutState">{registered ? "✓" : refunded ? "↩" : review ? "!" : <span className="checkoutSpinner" />}</div>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="checkoutSummary">
        <div><span>Domena</span><strong>{status.domain || "—"}</strong></div>
        <div><span>Płatność</span><strong>{formatMoney(status.amountTotal, status.currency)}</strong></div>
        <div><span>Status</span><strong>{registered ? "zarejestrowana" : refunded ? "zwrot" : review ? "weryfikacja" : paid ? "opłacona" : status.paymentStatus}</strong></div>
      </div>
      {status.email && <small>Kontakt do zamówienia: {status.email}</small>}
      {!registered && !refunded && !review && <p className="checkoutAuto">Status odświeża się automatycznie.</p>}
      <a className="checkoutBack" href="/">← Wróć do wyszukiwarki domen</a>
    </div>
  );
}
