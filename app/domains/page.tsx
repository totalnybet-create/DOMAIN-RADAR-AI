"use client";

import { FormEvent, useState } from "react";
import styles from "./page.module.css";

type Result = {
  domain: string;
  state: "available" | "registered" | "unknown";
  currency?: string;
  price?: number;
  renewalPrice?: number;
  detailsError?: string;
};

const TLD_OPTIONS = ["pl", "com", "eu", "online", "shop", "store", "de", "cz", "net", "org", "io", "ai", "co"];
const DEFAULT_TLDS = ["pl", "com", "eu", "online", "shop"];

function money(value: number | undefined, currency = "PLN") {
  if (value === undefined) return "Cena po sprawdzeniu";
  try {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function DomainsStorefront() {
  const [query, setQuery] = useState("enazwa");
  const [selected, setSelected] = useState(DEFAULT_TLDS);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [buyingDomain, setBuyingDomain] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function toggle(tld: string) {
    setSelected((current) =>
      current.includes(tld) ? current.filter((item) => item !== tld) : [...current, tld]
    );
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || !selected.length || loading) return;

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dynadot/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, tlds: selected }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Nie udało się sprawdzić domen.");
      setResults(payload.results || []);
    } catch (cause) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : "Błąd wyszukiwania.");
    } finally {
      setLoading(false);
    }
  }

  async function buyDomain(domain: string) {
    if (buyingDomain) return;
    setBuyingDomain(domain);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Nie udało się rozpocząć płatności.");
      }
      window.location.href = payload.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Błąd płatności.");
      setBuyingDomain(null);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>E-DOMAIN · WYSZUKIWARKA I SPRZEDAŻ DOMEN</div>
          <h1>Sprawdź domenę,<br />porównaj cenę i kup</h1>
          <p>
            To osobna wyszukiwarka konkretnych domen. Wpisujesz nazwę, porównujesz rozszerzenia i ceny,
            a dostępną domenę przechodzisz od razu do zakupu.
          </p>
        </div>
        <div className={styles.menuWrap}>
          <button type="button" className={styles.more} onClick={() => setMenuOpen((value) => !value)}>•••</button>
          {menuOpen && (
            <div className={styles.menu}>
              <button type="button" onClick={() => setResults([])}>Wyczyść wyniki</button>
              <button type="button" onClick={() => setSelected(DEFAULT_TLDS)}>Przywróć rozszerzenia</button>
            </div>
          )}
        </div>
      </header>

      <section className={styles.search}>
        <form onSubmit={lookup}>
          <label htmlFor="q">Nazwa domeny lub fragment</label>
          <input id="q" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="np. enazwa" />
          <button className={styles.searchButton} disabled={loading || !query.trim()}>
            {loading ? "Sprawdzam…" : "⌕  Sprawdź domeny i ceny"}
          </button>

          <div className={styles.pills}>
            {TLD_OPTIONS.map((tld) => (
              <button
                type="button"
                key={tld}
                className={selected.includes(tld) ? styles.pillActive : styles.pill}
                onClick={() => toggle(tld)}
              >
                .{tld}
              </button>
            ))}
          </div>

          <button type="button" className={styles.advanced} onClick={() => setAdvancedOpen((value) => !value)}>
            ☷ &nbsp; Zaawansowane <span>{advancedOpen ? "⌃" : "⌄"}</span>
          </button>

          {advancedOpen && (
            <div className={styles.advancedPanel}>
              <label>
                Widok
                <select defaultValue="all">
                  <option value="all">Wszystkie rozszerzenia</option>
                  <option value="available">Tylko dostępne</option>
                </select>
              </label>
              <label>
                Zakres
                <select defaultValue="13">
                  <option value="5">5 rozszerzeń</option>
                  <option value="13">Do 13 rozszerzeń</option>
                </select>
              </label>
            </div>
          )}
        </form>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        {results.length ? `${results.length} sprawdzonych rozszerzeń` : "Wyniki pokażą aktualną dostępność i cenę klienta"}
      </div>

      <section className={styles.results}>
        {results.map((item) => (
          <article className={styles.card} key={item.domain}>
            <div className={styles.cardHead}>
              <div>
                <h2>{item.domain}</h2>
                <div className={styles.state}>
                  <i className={item.state === "available" ? styles.green : styles.gray} />
                  {item.state === "available"
                    ? "Dostępna do rejestracji"
                    : item.state === "registered"
                      ? "Zajęta"
                      : "Status do potwierdzenia"}
                </div>
              </div>
            </div>

            {item.state === "available" && (
              <>
                <div className={styles.priceLine}>
                  <strong>Cena zakupu</strong>
                  <b>{money(item.price, item.currency)}</b>
                </div>
                <div className={styles.renew}>
                  Odnowienie / rok <span>{money(item.renewalPrice, item.currency)}</span>
                </div>
                <div className={styles.details}>
                  <div>◉ <span>Dostępność</span><b>potwierdzona</b></div>
                  <div>♢ <span>Registrar</span><b>Dynadot</b></div>
                  <div>✥ <span>Cena końcowa</span><b>sprawdzana przy zakupie</b></div>
                </div>
                <div className={styles.actions}>
                  <button type="button" onClick={() => buyDomain(item.domain)} disabled={buyingDomain === item.domain}>
                    {buyingDomain === item.domain ? "Przechodzę do płatności…" : "Kup domenę"}
                  </button>
                </div>
                {item.detailsError && <span className={styles.note}>{item.detailsError}</span>}
              </>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
