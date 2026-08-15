"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";

type Result = {
  domain: string;
  state: "available" | "registered" | "unknown";
  currency?: string;
  price?: number;
  renewalPrice?: number;
  detailsError?: string;
};

type ContactForm = {
  name: string;
  email: string;
  phoneCc: string;
  phoneNumber: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const TLD_OPTIONS = ["pl", "com", "eu", "online", "shop", "store", "de", "cz", "net", "org", "io", "ai", "co"];
const DEFAULT_TLDS = ["pl", "com", "eu", "online", "shop"];
const EMPTY_CONTACT: ContactForm = {
  name: "",
  email: "",
  phoneCc: "48",
  phoneNumber: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "PL",
};

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
  const [query, setQuery] = useState("domenago");
  const [selected, setSelected] = useState(DEFAULT_TLDS);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [buyingDomain, setBuyingDomain] = useState<string | null>(null);
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const orderedResults = useMemo(
    () => [...results].sort((a, b) => Number(b.state === "available") - Number(a.state === "available")),
    [results],
  );
  const availableCount = results.filter((item) => item.state === "available").length;

  function toggle(tld: string) {
    setSelected((current) =>
      current.includes(tld) ? current.filter((item) => item !== tld) : [...current, tld],
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

  async function startCheckout(domain: string, contactData?: ContactForm) {
    if (buyingDomain && buyingDomain !== domain) return;
    setBuyingDomain(domain);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, ...(contactData ? { contact: contactData } : {}) }),
      });
      const payload = await response.json();
      if (payload.requiresContact) {
        setPendingDomain(domain);
        setBuyingDomain(null);
        return;
      }
      if (!response.ok || !payload.url) throw new Error(payload.error || "Nie udało się rozpocząć płatności.");
      window.location.href = payload.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Błąd płatności.");
      setBuyingDomain(null);
    }
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingDomain || buyingDomain) return;
    await startCheckout(pendingDomain, contact);
  }

  function closeContact() {
    if (buyingDomain) return;
    setPendingDomain(null);
  }

  function travelSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (String(value).trim()) params.set(key, String(value));
    }
    window.location.href = `https://lapwyjazd.pl${params.size ? `?${params.toString()}` : ""}`;
  }

  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <nav className={styles.nav} aria-label="Główna nawigacja">
          <a className={styles.brand} href="#top" aria-label="DomenaGo — strona główna">
            Domena<span>Go</span>
          </a>
          <div className={styles.navLinks}>
            <a href="#domeny">Domeny</a>
            <a href="#po-zakupie">Hosting</a>
            <a href="#po-zakupie">Poczta</a>
            <a href="#po-zakupie">SSL</a>
            <a href="#jak-dziala">Jak to działa</a>
          </div>
          <a className={styles.navCta} href="#domeny">Znajdź domenę</a>
        </nav>

        <section className={styles.hero} id="top">
          <div className={styles.heroBadge}>WYSZUKIWARKA I ZAKUP DOMEN</div>
          <h1>Znajdź domenę.<br />Kup w kilka kliknięć.</h1>
          <p>Sprawdź dostępność, porównaj rozszerzenia i przejdź bezpośrednio do zakupu wybranej domeny.</p>
        </section>

        <section className={styles.searchPanel} id="domeny">
          <form onSubmit={lookup}>
            <label htmlFor="q">Nazwa domeny</label>
            <div className={styles.searchRow}>
              <div className={styles.inputWrap}>
                <input
                  id="q"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="np. moja-firma"
                  autoComplete="off"
                />
                {query && (
                  <button className={styles.clearButton} type="button" onClick={() => setQuery("")} aria-label="Wyczyść nazwę">×</button>
                )}
              </div>
              <button className={styles.searchButton} disabled={loading || !query.trim() || !selected.length}>
                {loading ? "Sprawdzam…" : "Sprawdź domeny i ceny"}
              </button>
            </div>

            <div className={styles.tldRow}>
              <button
                type="button"
                className={selected.length === TLD_OPTIONS.length ? styles.pillActive : styles.pill}
                onClick={() => setSelected(TLD_OPTIONS)}
              >
                Wszystkie
              </button>
              {TLD_OPTIONS.map((tld) => (
                <button
                  type="button"
                  key={tld}
                  className={selected.includes(tld) ? styles.pillActive : styles.pill}
                  onClick={() => toggle(tld)}
                >
                  .{tld}{selected.includes(tld) ? "  ✓" : ""}
                </button>
              ))}
            </div>

            <button type="button" className={styles.advanced} onClick={() => setAdvancedOpen((value) => !value)}>
              <span>Ustawienia rozszerzeń</span><span>{advancedOpen ? "−" : "+"}</span>
            </button>

            {advancedOpen && (
              <div className={styles.advancedPanel}>
                <div>
                  <strong>Wybrane rozszerzenia</strong>
                  <span>{selected.length} z {TLD_OPTIONS.length}</span>
                </div>
                <button type="button" onClick={() => setSelected(DEFAULT_TLDS)}>Przywróć domyślne</button>
                <button type="button" onClick={() => setSelected([])}>Wyczyść wybór</button>
              </div>
            )}
          </form>
          <div className={styles.liveNote}><span>●</span> Dostępność i ceny są sprawdzane przy wyszukiwaniu.</div>
        </section>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <section className={styles.resultsSection} aria-live="polite">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.sectionEyebrow}>WYNIKI</span>
              <h2>{results.length ? `Wyniki dla „${query}”` : "Najpierw sprawdź swoją nazwę"}</h2>
            </div>
            {results.length > 0 && <div className={styles.resultCount}>{availableCount} dostępnych / {results.length} sprawdzonych</div>}
          </div>

          {!results.length && !loading && (
            <div className={styles.emptyState}>
              <strong>Wpisz nazwę i wybierz rozszerzenia.</strong>
              <span>Pokażemy dostępność oraz aktualną cenę dla każdego wyniku.</span>
            </div>
          )}

          <div className={styles.results}>
            {orderedResults.map((item) => (
              <article className={`${styles.card} ${item.state !== "available" ? styles.cardMuted : ""}`} key={item.domain}>
                <div className={styles.cardHead}>
                  <h3>{item.domain}</h3>
                  <span className={item.state === "available" ? styles.availableBadge : styles.unavailableBadge}>
                    {item.state === "available" ? "Dostępna" : item.state === "registered" ? "Zajęta" : "Do potwierdzenia"}
                  </span>
                </div>

                {item.state === "available" ? (
                  <>
                    <div className={styles.priceLabel}>Cena za pierwszy rok</div>
                    <div className={styles.price}>{money(item.price, item.currency)}</div>
                    <button
                      className={styles.buyButton}
                      type="button"
                      onClick={() => startCheckout(item.domain)}
                      disabled={Boolean(buyingDomain)}
                    >
                      {buyingDomain === item.domain ? "Przechodzę do płatności…" : "Kup domenę"}
                    </button>
                    <div className={styles.domainDetails}>
                      <div><span>↻ Odnowienie</span><b>{money(item.renewalPrice, item.currency)} / rok</b></div>
                      <div><span>↔ Rejestrator</span><b>Dynadot</b></div>
                      <div><span>◎ Dostępność</span><b>sprawdzona online</b></div>
                    </div>
                    {item.detailsError && <span className={styles.note}>{item.detailsError}</span>}
                  </>
                ) : (
                  <div className={styles.unavailableText}>Ta domena nie jest obecnie dostępna do zakupu.</div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className={styles.stepsSection} id="jak-dziala">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.sectionEyebrow}>PROSTY PROCES</span>
              <h2>Od nazwy do zakupu</h2>
            </div>
          </div>
          <div className={styles.stepsGrid}>
            <article><span>01</span><h3>Wpisz nazwę</h3><p>Podaj markę, projekt albo dowolny pomysł na domenę.</p></article>
            <article><span>02</span><h3>Porównaj wyniki</h3><p>Sprawdź rozszerzenia, dostępność i cenę przed zakupem.</p></article>
            <article><span>03</span><h3>Kup domenę</h3><p>Wybierz dostępny adres i przejdź do bezpiecznego checkoutu.</p></article>
          </div>
        </section>

        <section className={styles.afterPurchase} id="po-zakupie">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.sectionEyebrow}>PO ZAKUPIE DOMENY</span>
              <h2>Wszystko, czego potrzebuje nowa marka</h2>
            </div>
          </div>
          <div className={styles.servicesGrid}>
            <article><div className={styles.serviceIcon}>▤</div><h3>Hosting</h3><p>Miejsce na stronę i aplikację.</p><span>Oferta w przygotowaniu</span></article>
            <article><div className={styles.serviceIcon}>✉</div><h3>Poczta</h3><p>Profesjonalny e-mail we własnej domenie.</p><span>Oferta w przygotowaniu</span></article>
            <article><div className={styles.serviceIcon}>◇</div><h3>SSL</h3><p>Bezpieczne połączenie dla Twojej strony.</p><span>Oferta w przygotowaniu</span></article>
            <article><div className={styles.serviceIcon}>▱</div><h3>Strona WWW</h3><p>Kolejny krok po zakupie domeny.</p><span>Oferta w przygotowaniu</span></article>
          </div>
        </section>

        <section className={styles.travelBox} id="wyjazdy">
          <div className={styles.travelCopy}>
            <span className={styles.sectionEyebrow}>OD DOMENY DO WYJAZDU</span>
            <h2>Szukasz hotelu?</h2>
            <p>Sprawdź noclegi na ŁapWyjazd i przejdź do naszej wyszukiwarki podróżniczej.</p>
          </div>
          <form className={styles.travelForm} onSubmit={travelSearch}>
            <label>Dokąd?<input name="destination" placeholder="np. Zakopane, Chorwacja" /></label>
            <label>Termin<input type="date" name="date" /></label>
            <label>Osoby<select name="guests" defaultValue="2"><option value="1">1 osoba</option><option value="2">2 osoby</option><option value="3">3 osoby</option><option value="4">4 osoby</option><option value="5">5+ osób</option></select></label>
            <button type="submit">Szukaj na ŁapWyjazd ↗</button>
          </form>
        </section>

        <footer className={styles.footer}>
          <a className={styles.brand} href="#top">Domena<span>Go</span></a>
          <p>Wyszukiwarka domen i narzędzia do startu online.</p>
          <a href="/radar" className={styles.footerLink}>Powered by Domain Radar AI</a>
        </footer>
      </div>

      {pendingDomain && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeContact()}>
          <section className={styles.contactModal} role="dialog" aria-modal="true" aria-labelledby="contact-title">
            <button className={styles.modalClose} type="button" onClick={closeContact} aria-label="Zamknij">×</button>
            <span className={styles.sectionEyebrow}>DANE WŁAŚCICIELA DOMENY</span>
            <h2 id="contact-title">Dokończ zakup {pendingDomain}</h2>
            <p>Dane są potrzebne rejestratorowi do zapisania domeny na właściwego właściciela.</p>
            <form className={styles.contactForm} onSubmit={submitContact}>
              <label className={styles.fullField}>Imię i nazwisko / nazwa właściciela<input required autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></label>
              <label>E-mail<input required type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
              <div className={styles.phoneFields}>
                <label>Kierunkowy<input required inputMode="numeric" value={contact.phoneCc} onChange={(e) => setContact({ ...contact, phoneCc: e.target.value })} /></label>
                <label>Telefon<input required inputMode="tel" autoComplete="tel" value={contact.phoneNumber} onChange={(e) => setContact({ ...contact, phoneNumber: e.target.value })} /></label>
              </div>
              <label className={styles.fullField}>Adres<input required autoComplete="street-address" value={contact.address1} onChange={(e) => setContact({ ...contact, address1: e.target.value })} /></label>
              <label className={styles.fullField}>Adres — dodatkowe informacje<input value={contact.address2} onChange={(e) => setContact({ ...contact, address2: e.target.value })} /></label>
              <label>Miasto<input required autoComplete="address-level2" value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} /></label>
              <label>Kod pocztowy<input required autoComplete="postal-code" value={contact.postalCode} onChange={(e) => setContact({ ...contact, postalCode: e.target.value })} /></label>
              <label>Województwo / region<input autoComplete="address-level1" value={contact.state} onChange={(e) => setContact({ ...contact, state: e.target.value })} /></label>
              <label>Kraj (kod 2-literowy)<input required maxLength={2} autoComplete="country" value={contact.country} onChange={(e) => setContact({ ...contact, country: e.target.value.toUpperCase() })} /></label>
              <button className={styles.contactSubmit} disabled={Boolean(buyingDomain)}>
                {buyingDomain ? "Przygotowuję płatność…" : "Przejdź do bezpiecznej płatności"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
