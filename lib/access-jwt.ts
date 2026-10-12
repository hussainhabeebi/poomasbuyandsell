// Verifies Cloudflare Access JWTs (RS256) against the team's published keys.
const KEY_CACHE_MS = 10 * 60 * 1000;
type Jwk = JsonWebKey & { kid?: string };
let keyCache: { domain: string; expires: number; keys: Map<string, CryptoKey> } | null = null;
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function decodeJson(segment: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
        return value && typeof value === "object" ? value : null;
    }
    catch {
        return null;
    }
}
async function signingKeys(domain: string, refresh = false, fetcher: typeof fetch = fetch): Promise<Map<string, CryptoKey>> {
    if (!refresh && keyCache && keyCache.domain === domain && keyCache.expires > Date.now())
        return keyCache.keys;
    const response = await fetcher(`https://${domain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok)
        throw new Error(`Cloudflare Access certificates unavailable (${response.status})`);
    const { keys = [] } = await response.json() as { keys?: Jwk[] };
    const imported = new Map<string, CryptoKey>();
    for (const jwk of keys) {
        if (!jwk.kid || jwk.kty !== "RSA")
            continue;
        imported.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    keyCache = { domain, expires: Date.now() + KEY_CACHE_MS, keys: imported };
    return imported;
}
export async function verifyAccessJwt(token: string, domain: string, audience: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
    const parts = token.split(".");
    if (parts.length !== 3)
        return null;
    const header = decodeJson(parts[0]), claims = decodeJson(parts[1]);
    if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string")
        return null;
    let key: CryptoKey | undefined;
    try {
        key = (await signingKeys(domain, false, fetcher)).get(header.kid) ?? (await signingKeys(domain, true, fetcher)).get(header.kid);
    }
    catch (error) {
        console.error("Cloudflare Access key lookup failed", error);
        return null;
    }
    if (!key)
        return null;
    let valid = false;
    try {
        valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    }
    catch {
        return null;
    }
    if (!valid)
        return null;
    const seconds = Math.floor(now / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience))
        return null;
    if (claims.iss !== `https://${domain}`)
        return null;
    if (typeof claims.exp !== "number" || claims.exp < seconds - 60)
        return null;
    if (typeof claims.nbf === "number" && claims.nbf > seconds + 60)
        return null;
    return claims;
}
