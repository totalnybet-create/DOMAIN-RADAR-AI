"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function GoogleAccountBar() {
  const { data, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/connections/aftermarket",
      });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signOut();
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const user = data?.user;

  return (
    <div style={{ maxWidth: 430, margin: "12px auto 0", padding: "0 14px" }}>
      <div style={{ border: "1px solid #14253d", background: "#0a1626", borderRadius: 16, padding: 12, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#00e5ff", fontSize: 11, fontWeight: 800, letterSpacing: ".08em" }}>DOMAIN RADAR ACCOUNT</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isPending ? "Sprawdzam sesję…" : user ? user.email || user.name || "Google account" : "Nie zalogowano"}
          </div>
        </div>
        {user ? (
          <button type="button" onClick={signOut} disabled={busy} style={{ border: "1px solid #243a58", background: "transparent", color: "#fff", borderRadius: 10, padding: "9px 11px", fontWeight: 700 }}>
            Wyloguj
          </button>
        ) : (
          <button type="button" onClick={signIn} disabled={busy || isPending} style={{ border: 0, background: "#fff", color: "#111", borderRadius: 10, padding: "9px 12px", fontWeight: 800 }}>
            {busy ? "Łączę…" : "Zaloguj przez Google"}
          </button>
        )}
      </div>
      <p style={{ color: "#8a99ad", fontSize: 11, lineHeight: 1.45, margin: "7px 3px 0" }}>
        Logowanie Google identyfikuje Ciebie w Domain Radar. Google nie udostępnia aplikacji zapisanych haseł do innych serwisów, więc hasło AfterMarket pozostaje osobnym zabezpieczonym credentialem.
      </p>
    </div>
  );
}
