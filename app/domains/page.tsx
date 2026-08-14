"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";

type LookupResult = {
  domain: string;
  state: "available" | "registered" | "unknown";
  premium?: boolean;
  currency?: string;
  price?: number;
  renewalPrice?: number;
};

const TLD_OPTIONS = ["pl", "com", "eu", "online", "shop", "store", "de", "cz", "net", "org", "io", "ai", "co"];
const DEFAULT_TLDS = ["pl", "com", "eu", "online", "shop"];

function money(value: number | undefined, currency = "PLN") {
  if (value === undefined) return "Cena po sprawdzeniu";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function DomainsStorefront() {
  const [query, setQuery] = useState("enazwa");
  const [selectedTlds, setSelectedTlds] = useState<string[]>(DEFAULT_TLDS);
  const [results, setResults] = useState<LookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);

  const available = useMemo(() => results.filter((item) => item.state === "available"), [results]);

  function toggleTld(tld: string) {
    setSelectedTlds((current) => current.includes(tld) ? current.filter((item) => item !== tld) : [...current, tld]);
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || selectedTlds.length === 0 || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dynadot/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, tlds: selectedTlds }),
      });
      const payload = await response.json();
      setConnected(payload.connected !== false);
      if (!response.ok) throw new Error(payload.error || `Błąd ${response.status}`);
      setResults(Array.isArray(payload.results) ? payload.results : []);
    } catch (lookupError) {
      setResults([]);
      setError(lookupError instanceof Error ? lookupError.message : "Nie udało się sprawdzić domen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.kicker}>DOMENY · REJESTRACJA · CENY LIVE</div>
        <div className={styles.heroLine}>
          <div>
            <h1>Znajdź swoją domenę</h1>
            <p>Sprawdzamy dostępność i aktualną cenę bezpośrednio u rejestratora. Bez fikcyjnych ofert i bez ręcznego przepisywania cennika.</p>
          </div>
          <div className={`${styles.liveBadge} ${connected === false ? styles.offline : ""}`}>
            {connected === false ? "DYNADOT: DO PODŁĄCZENIA" : connected === true ? "DYNADOT LIVE" : "LIVE PRICING"}
          </div>
        </div>
      </header>

      <section className={styles.searchPanel}>
        <form onSubmit={lookup}>
          <label className={styles.label} htmlFor="domain-query">Nazwa domeny</label>
          <div className={styles.searchRow}>
            <input id="domain-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="np. enazwa" autoComplete="off" />
            <button type="submit" disabled={loading || !query.trim() || selectedTlds.length === 0}>{loading ? "Sprawdzam…" : "Sprawdź domeny"}</button>
          </div>

          <div className={styles.tldTitle}>Rozszerzenia</div>
          <div className={styles.tlds}>
            {TLD_OPTIONS.map((tld) => (
              <button key={tld} type="button" className={selectedTlds.includes(tld) ? styles.tldActive : styles.tld} onClick={() => toggleTld(tld)}>
                .{tld}
              </button>
            ))}
          </div>
        </form>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.resultsSection}>
        <div className={styles.resultsHead}>
          <div>
            <span>WYNIKI</span>
            <h2>{results.length ? `${available.length} dostępnych domen` : "Wpisz nazwę i sprawdź ceny"}</h2>
          </div>
          {results.length > 0 && <div className={styles.counter}>{results.length} sprawdzonych</div>}
        </div>

        {results.length > 0 && (
          <div className={styles.grid}>
            {results.map((item) => (
              <article key={item.domain} className={`${styles.domainCard} ${item.state === "available" ? styles.domainAvailable : ""}`}>
                <div className={styles.cardTop}>
                  <span className={styles.domainName}>{item.domain}</span>
                  <span className={`${styles.state} ${styles[item.state]}`}>{item.state === "available" ? "DOSTĘPNA" : item.state === "registered" ? "ZAJĘTA" : "SPRAWDŹ"}</span>
                </div>

                {item.state === "available" ? (
                  <>
                    <div className={styles.price}>{money(item.price, item.currency)}</div>
                    <div className={styles.priceLabel}>cena za pierwszy rok</div>
                    <div className={styles.metaRow}>
                      <span>Odnowienie</span>
                      <strong>{money(item.renewalPrice, item.currency)}</strong>
                    </div>
                    {item.premium && <div className={styles.premium}>DOMENA PREMIUM</div>}
                    <div className={styles.checkoutNote}>Płatność i automatyczna rejestracja zostaną podłączone do tego przycisku w następnym etapie.</div>
                    <button className={styles.buyButton} type="button" disabled>Wybierz domenę</button>
                  </>
                ) : (
                  <div className={styles.unavailableText}>Ta domena nie jest obecnie dostępna do zwykłej rejestracji.</div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <span>DOMAIN RADAR AI</span>
        <span>Ceny pobierane z backendu — klucz API nie trafia do przeglądarki klienta.</span>
      </footer>
    </main>
  );
}
