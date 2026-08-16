import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const AFTERMARKET_VAULT_COOKIE = "dr_aftermarket_v1";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
const AAD = Buffer.from("domain-radar:aftermarket-vault:v1", "utf8");

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

export function sealAftermarketVault(payload: StoredAftermarketCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function openAftermarketVault(token: string | undefined | null): StoredAftermarketCredentials | null {
  if (!token) return null;
  try {
    const [ivRaw, tagRaw, dataRaw] = token.split(".");
    if (!ivRaw || !tagRaw || !dataRaw) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(clear) as StoredAftermarketCredentials;
    if (parsed?.version !== 1 || !parsed.apiKey || !parsed.apiPassword) return null;
    return parsed;
  } catch {
    return null;
  }
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

export function aftermarketVaultSetCookie(payload: StoredAftermarketCredentials) {
  const token = sealAftermarketVault(payload);
  return `${AFTERMARKET_VAULT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export function aftermarketVaultClearCookie() {
  return `${AFTERMARKET_VAULT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
