// Signed session cookies and Google ID token checks for Sign in with Google.
// Kept free of framework imports so it can be unit tested under Node.
export type SessionUser = { sub: string; email: string; name: string | null };
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function decodeJson(segment: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(new TextDecoder().decode(fromBase64Url(segment)));
        return value && typeof value === "object" ? value : null;
    }
    catch {
        return null;
    }
}
async function hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export function randomToken(bytes = 32): string {
    return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function signSession(user: SessionUser, secret: string, now = Date.now()): Promise<string> {
    const payload = base64Url(encoder.encode(JSON.stringify({ ...user, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })));
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
    return `${payload}.${base64Url(signature)}`;
}
export async function verifySession(token: string, secret: string, now = Date.now()): Promise<SessionUser | null> {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined || !secret)
        return null;
    let valid = false;
    try {
        valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), encoder.encode(payload));
    }
    catch {
        return null;
    }
    if (!valid)
        return null;
    const claims = decodeJson(payload);
    if (!claims || typeof claims.exp !== "number" || claims.exp < Math.floor(now / 1000))
        return null;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email)
        return null;
    return { sub: claims.sub, email: claims.email, name: typeof claims.name === "string" && claims.name ? claims.name : null };
}
// The ID token comes straight from Google's token endpoint over TLS in exchange
// for a single-use code and the client secret, so its claims are checked here
// rather than its signature (as Google's OpenID Connect guide allows).
export function googleIdTokenUser(idToken: string, clientId: string, now = Date.now()): SessionUser | null {
    const claims = decodeJson(idToken.split(".")[1] ?? "");
    if (!claims)
        return null;
    if (claims.aud !== clientId)
        return null;
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com")
        return null;
    if (typeof claims.exp !== "number" || claims.exp < Math.floor(now / 1000) - 60)
        return null;
    if (claims.email_verified !== true || typeof claims.email !== "string" || typeof claims.sub !== "string" || !claims.sub)
        return null;
    const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null;
    return { sub: claims.sub, email: claims.email.toLowerCase(), name };
}
