import { getAftermarketConfig } from "@/lib/aftermarket";
import { provisionAftermarketKey } from "@/lib/aftermarket-provisioner";
import { resolveAftermarketCredentials } from "@/lib/aftermarket-runtime";
import {
  aftermarketPendingClearCookie,
  aftermarketPendingSetCookie,
  aftermarketVaultClearCookie,
  aftermarketVaultSetCookie,
  readAftermarketPendingSession,
  readAftermarketVault,
  type PendingAftermarketSession,
  type StoredAftermarketCredentials,
} from "@/lib/aftermarket-vault";

export const runtime = "nodejs";
export const maxDuration = 60;

const attemptStore = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

function rateLimited(request: Request) {
  const now = Date.now();
  const key = clientIp(request);
  const current = attemptStore.get(key);
  if (!current || current.resetAt <= now) {
    attemptStore.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function jsonHeaders(...cookies: string[]) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

export async function GET(request: Request) {
  const credentials = resolveAftermarketCredentials(request);
  const vault = readAftermarketVault(request);
  const config = getAftermarketConfig();
  return Response.json(
    {
      connected: Boolean(credentials),
      source: credentials?.source || null,
      keyName: vault?.keyName || (config.apiKey ? "Environment key" : null),
      autoRepairReady: Boolean(vault?.account?.login && vault?.account?.password),
      executionEnabled: config.executionEnabled,
      permissions: "sniper-read-only",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  if (rateLimited(request)) return Response.json({ error: "Zbyt wiele prób. Spróbuj ponownie za minutę." }, { status: 429 });

  let body: {
    login?: string;
    password?: string;
    otp?: string;
    keyName?: string;
    rememberAccount?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });
  }

  const login = body.login?.trim() || "";
  const password = body.password || "";
  if (!login || password.length < 6) {
    return Response.json({ error: "Podaj login i hasło do konta AfterMarket." }, { status: 400 });
  }

  const pending = body.otp?.trim() ? readAftermarketPendingSession(request) : null;
  const result = await provisionAftermarketKey({
    login,
    password,
    otp: body.otp?.trim() || undefined,
    keyName: body.keyName?.trim() || "Domain Radar PL Sniper",
    ...(pending ? { session: { url: pending.url, cookies: pending.cookies } } : {}),
  });

  if (!result.ok) {
    const status = result.code === "OTP_REQUIRED" || result.code === "HUMAN_VERIFICATION" ? 409 : 502;
    if (result.code === "OTP_REQUIRED") {
      const pendingSession: PendingAftermarketSession = {
        version: 1,
        url: result.session.url,
        cookies: result.session.cookies,
        createdAt: new Date().toISOString(),
      };
      return Response.json(
        {
          ok: false,
          code: result.code,
          error: result.message,
          requiresOtp: true,
          humanVerificationRequired: false,
        },
        { status, headers: jsonHeaders(aftermarketPendingSetCookie(pendingSession)) },
      );
    }
    return Response.json(
      {
        ok: false,
        code: result.code,
        error: result.message,
        requiresOtp: false,
        humanVerificationRequired: result.code === "HUMAN_VERIFICATION",
      },
      { status, headers: jsonHeaders(aftermarketPendingClearCookie()) },
    );
  }

  const stored: StoredAftermarketCredentials = {
    version: 1,
    apiKey: result.apiKey,
    apiPassword: result.apiPassword,
    keyName: result.keyName,
    createdAt: new Date().toISOString(),
    ...(body.rememberAccount === false ? {} : { account: { login, password } }),
  };

  return Response.json(
    {
      ok: true,
      connected: true,
      keyName: result.keyName,
      keyFingerprint: `••••${result.apiKey.slice(-4)}`,
      autoRepairReady: Boolean(stored.account),
      permissions: "sniper-read-only",
    },
    {
      headers: jsonHeaders(
        aftermarketVaultSetCookie(stored),
        aftermarketPendingClearCookie(),
      ),
    },
  );
}

export async function DELETE() {
  return Response.json(
    { ok: true, connected: false },
    {
      headers: jsonHeaders(
        aftermarketVaultClearCookie(),
        aftermarketPendingClearCookie(),
      ),
    },
  );
}
