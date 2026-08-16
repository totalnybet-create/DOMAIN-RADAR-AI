import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const AFTERMARKET_VAULT_COOKIE = "dr_aftermarket_v1";
export const AFTERMARKET_PENDING_COOKIE = "dr_aftermarket_pending_v1";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
const PENDING_MAX_AGE = 10 * 60;
const VAULT_AAD = Buffer.from("domain-radar:aftermarket-vault:v1", "utf8");
const PENDING_AAD = Buffer.from("domain-radar:aftermarket-pending:v1", "utf8");

export type StoredAftermarketAccount = {
  login: string;
  password: string;
};

export type StoredAftermarketCredentials = {
  version: 1;
  apiKey: string;
  apiPassword: string;
  keyName: string;
  createdAt: string;
  account?: StoredAftermarketAccount;
};

export type PendingAftermarketSession = {
  version: 1;
  url: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  createdAt: string;
};

function rootSecret() {
  const secret =
    process.env.AFTERMARKET_VAULT_KEY?.trim() ||
    process.env.DYNADOT_API_SECRET?.trim() ||
    process.env.DOMAIN_RADAR_REGISTRATION_TOKEN?.trim() ||
    "";
  if (secret.length < 16) throw new Error("AfterMarket vault encryption is not configured.");
  return secret;
}

function encryptionKey() {
  return createHash("sha256")
    .update("domain-radar/aftermarket-vault/v1\0", "utf8")
    .update(rootSecret(), "utf8")
    .digest();
}

function sealJson(payload: unknown, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

function openJson<T>(token: string | undefined | null, aad: Buffer): T | null {
  if (!token) return null;
  try {
    const [ivRaw, tagRaw, dataRaw] = token.split(".");
    if (!ivRaw || !tagRaw || !dataRaw) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(clear) as T;
  } catch {
    return null;
  }
}

export function sealAftermarketVault(payload: StoredAftermarketCredentials) {
  return sealJson(payload, VAULT_AAD);
}

export function openAftermarketVault(token: string | undefined | null): StoredAftermarketCredentials | null {
  const parsed = openJson<StoredAftermarketCredentials>(token, VAULT_AAD);
  if (parsed?.version !== 1 || !parsed.apiKey || !parsed.apiPassword) return null;
  return parsed;
}

export function sealAftermarketPendingSession(payload: PendingAftermarketSession) {
  return sealJson(payload, PENDING_AAD);
}

export function openAftermarketPendingSession(token: string | undefined | null): PendingAftermarketSession | null {
  const parsed = openJson<PendingAftermarketSession>(token, PENDING_AAD);
  if (parsed?.version !== 1 || !parsed.url || !Array.isArray(parsed.cookies)) return null;
  const createdAt = Date.parse(parsed.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_MAX_AGE * 1000) return null;
  return parsed;
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const chunk of header.split(";")) {
    const index = chunk.indexOf("=");
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return null;
}

export function readAftermarketVault(request: Request) {
  return openAftermarketVault(readCookie(request, AFTERMARKET_VAULT_COOKIE));
}

export function readAftermarketPendingSession(request: Request) {
  return openAftermarketPendingSession(readCookie(request, AFTERMARKET_PENDING_COOKIE));
}

export function aftermarketVaultSetCookie(payload: StoredAftermarketCredentials) {
  const token = sealAftermarketVault(payload);
  return `${AFTERMARKET_VAULT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export function aftermarketVaultClearCookie() {
  return `${AFTERMARKET_VAULT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function aftermarketPendingSetCookie(payload: PendingAftermarketSession) {
  const token = sealAftermarketPendingSession(payload);
  return `${AFTERMARKET_PENDING_COOKIE}=${encodeURIComponent(token)}; Path=/api/aftermarket/connection; Max-Age=${PENDING_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export function aftermarketPendingClearCookie() {
  return `${AFTERMARKET_PENDING_COOKIE}=; Path=/api/aftermarket/connection; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
