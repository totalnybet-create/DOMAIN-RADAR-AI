"use client";

import { useEffect, useRef, useState } from "react";

type RegistrarQuote = {
  id: string;
  name: string;
  status: "live" | "tld-price" | "not-configured" | "unavailable" | "error";
  available?: boolean;
  registration?: number;
  renewal?: number;
  currency?: string;
  premium?: boolean;
  note?: string;
  buyUrl: string;
};

type Payload = {
  quotes: RegistrarQuote[];
  confirmedAvailable?: number;
  confirmedUnavailable?: number;
  checkedAt?: string;
};

function money(value?: number, currency?: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ""}`.trim();
  }
}

export function RegistrarQuotes({ domain }: { domain: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || started) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setStarted(true);
        observer.disconnect();
      }
    }, { rootMargin: "250px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let active = true;
    setLoading(true);
    fetch(`/api/prices?domain=${encodeURIComponent(domain)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`quotes-${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then((payload) => { if (active) setData(payload); })
      .catch(() => { if (active) setData({ quotes: [] }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [domain, started]);

  const verified = (data?.confirmedAvailable ?? 0) > 0;

  return (
    <div className="registrarQuotes" ref={hostRef}>
      <div className="quotesHead">
        <strong>Porównanie cen</strong>
        <span className={verified ? "verificationBadge verified" : "verificationBadge"}>
          {verified ? `RDAP + ${data?.confirmedAvailable} rejestrator` : "RDAP"}
        </span>
      </div>
      {!started || loading ? <div className="quoteLoading">Pobieram ceny…</div> : null}
      {data && !loading && data.quotes.length === 0 ? <div className="quoteLoading">Ceny chwilowo niedostępne.</div> : null}
      {data?.quotes.map((quote) => (
        <div className="quoteRow" key={quote.id}>
          <div>
            <strong>{quote.name}</strong>
            <small>{quote.status === "live" ? "sprawdzenie LIVE" : quote.status === "tld-price" ? "cennik TLD" : quote.status === "not-configured" ? "API do podłączenia" : quote.status === "unavailable" ? "niedostępna" : "błąd"}</small>
          </div>
          <div className="quotePrice">
            <strong>{money(quote.registration, quote.currency)}</strong>
            {quote.renewal != null ? <small>odnowienie {money(quote.renewal, quote.currency)}</small> : <small>{quote.note || ""}</small>}
          </div>
          <a href={quote.buyUrl} target="_blank" rel="noreferrer">Sprawdź</a>
        </div>
      ))}
    </div>
  );
}
