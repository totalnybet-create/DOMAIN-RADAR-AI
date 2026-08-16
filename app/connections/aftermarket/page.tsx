"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./page.module.css";

type ConnectionStatus = {
  connected: boolean;
  source?: "environment" | "vault" | null;
  keyName?: string | null;
  autoRepairReady?: boolean;
  executionEnabled?: boolean;
  permissions?: string;
};

type ConnectResponse = ConnectionStatus & {
  ok?: boolean;
  error?: string;
  code?: string;
  requiresOtp?: boolean;
  humanVerificationRequired?: boolean;
  keyFingerprint?: string;
};

export default function AftermarketConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [keyName, setKeyName] = useState("Domain Radar PL Sniper");
  const [rememberAccount, setRememberAccount] = useState(true);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const response = await fetch("/api/aftermarket/connection", { cache: "no-store" });
      const payload = (await response.json()) as ConnectionStatus;
      setStatus(payload);
    } catch {
      setStatus({ connected: false });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setMessage("Loguję się do AfterMarket i tworzę minimalny klucz read-only…");
    try {
      const response = await fetch("/api/aftermarket/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password, otp: otp || undefined, keyName, rememberAccount }),
      });
      const payload = (await response.json()) as ConnectResponse;
      if (!response.ok || !payload.connected) {
        if (payload.requiresOtp) {
          setNeedsOtp(true);
          setMessage("AfterMarket poprosił o kod jednorazowy. Wpisz kod tutaj — nie musisz otwierać panelu AfterMarket.");
        } else if (payload.humanVerificationRequired) {
          setMessage("");
          setError("AfterMarket uruchomił CAPTCHA / weryfikację człowieka. Domain Radar jej nie obchodzi; taki challenge trzeba zatwierdzić legalną metodą serwisu.");
        } else {
          setMessage("");
          setError(payload.error || "Nie udało się połączyć AfterMarket.");
        }
        return;
      }
      setNeedsOtp(false);
      setOtp("");
      setPassword("");
      setMessage(`Połączono. Klucz ${payload.keyFingerprint || "API"} został utworzony, przetestowany i zabezpieczony.`);
      await refresh();
    } catch {
      setMessage("");
      setError("Nie udało się zakończyć provisioningu AfterMarket.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await fetch("/api/aftermarket/connection", { method: "DELETE" });
      setStatus({ connected: false });
      setMessage("Połączenie usunięte z Domain Radar. Klucz w samym AfterMarket nie jest automatycznie kasowany.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.header}>
        <a href="/sniper" className={styles.back}>← PL Sniper</a>
        <div className={styles.badge}>SECURE CONNECTION</div>
        <h1>Połącz <span>AfterMarket</span></h1>
        <p>Domain Radar zaloguje się w Twoim imieniu, utworzy klucz API z minimalnymi uprawnieniami do skanowania i od razu sprawdzi, czy PL Sniper może z niego korzystać.</p>
      </section>

      <section className={styles.securityStrip}>
        <div><strong>READ-ONLY</strong><span>bez kupowania i licytowania</span></div>
        <div><strong>HTTPONLY</strong><span>API password poza frontendem</span></div>
        <div><strong>AES-256-GCM</strong><span>szyfrowany vault</span></div>
      </section>

      {status?.connected ? (
        <section className={styles.connectedCard}>
          <div className={styles.statusDot}>✓</div>
          <div className={styles.connectedCopy}>
            <span>AFTERMARKET CONNECTED</span>
            <h2>{status.keyName || "Domain Radar API key"}</h2>
            <p>Źródło: {status.source === "environment" ? "sekret serwerowy" : "zaszyfrowany vault"}. Auto-naprawa: {status.autoRepairReady ? "gotowa" : "wyłączona"}.</p>
          </div>
          <a className={styles.primaryLink} href="/sniper">Otwórz PL Sniper →</a>
          {status.source === "vault" && <button className={styles.disconnect} type="button" onClick={disconnect} disabled={loading}>Usuń połączenie z Domain Radar</button>}
          <div className={styles.executionLock}>AUTO BUY: {status.executionEnabled ? "ARMED" : "LOCKED"} — połączenie konta nie odblokowuje wydawania pieniędzy.</div>
        </section>
      ) : (
        <section className={styles.formCard}>
          <div className={styles.formHead}>
            <div><span>KROK 1</span><h2>Dane konta AfterMarket</h2></div>
            <small>Nie wpisujesz ich na stronie AfterMarket — provisioner robi to za Ciebie.</small>
          </div>
          <form onSubmit={connect} autoComplete="off">
            <label>
              <span>Login AfterMarket</span>
              <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required placeholder="Twój login" />
            </label>
            <label>
              <span>Hasło do konta</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="••••••••••••" />
            </label>
            {needsOtp && (
              <label className={styles.otpField}>
                <span>Kod jednorazowy / 2FA</span>
                <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\s/g, ""))} autoComplete="one-time-code" inputMode="numeric" placeholder="Kod z SMS / e-mail / aplikacji" />
              </label>
            )}
            <label>
              <span>Nazwa tworzonego klucza</span>
              <input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={80} />
            </label>

            <div className={styles.permissions}>
              <div><strong>Uprawnienia nadawane automatycznie</strong><span>tylko operacje potrzebne przez PL Sniper</span></div>
              <ul>
                <li>odczyt domen wygasających / spadających</li>
                <li>odczyt list aukcji i ofert rynku</li>
                <li className={styles.denied}>bez rejestracji, transferów, kupowania i licytacji</li>
              </ul>
            </div>

            <label className={styles.remember}>
              <input type="checkbox" checked={rememberAccount} onChange={(event) => setRememberAccount(event.target.checked)} />
              <span><strong>Zachowaj zaszyfrowane dane konta do auto-naprawy klucza</strong><small>Wyłączenie tej opcji zachowa tylko API key + API password.</small></span>
            </label>

            <button className={styles.connectButton} disabled={loading || !login.trim() || password.length < 6}>
              {loading ? "Provisioning w toku…" : needsOtp ? "Wyślij kod i dokończ połączenie" : "Połącz AfterMarket automatycznie"}
            </button>
          </form>
        </section>
      )}

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.explainer}>
        <h2>Co zrobi bot?</h2>
        <ol>
          <li><span>01</span><div><strong>Zaloguje konto</strong><p>Użyje danych wyłącznie w połączeniu serwerowym z AfterMarket.</p></div></li>
          <li><span>02</span><div><strong>Utworzy minimalny klucz</strong><p>Jeśli nie rozpozna bezpiecznie uprawnień, przerwie operację zamiast zaznaczać wszystko.</p></div></li>
          <li><span>03</span><div><strong>Sprawdzi API</strong><p>Testuje oba źródła wymagane przez PL Sniper przed zapisaniem połączenia.</p></div></li>
          <li><span>04</span><div><strong>Zabezpieczy credential</strong><p>Frontend dostaje tylko informację o sukcesie i końcówkę klucza, nigdy API password.</p></div></li>
        </ol>
      </section>
    </main>
  );
}
