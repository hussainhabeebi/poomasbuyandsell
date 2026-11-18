// Cloudflare Turnstile server-side validation (Siteverify API).
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export type TurnstileResult = 'ok' | 'failed' | 'unconfigured' | 'unavailable';
export async function verifyTurnstile(token: unknown, secret: string, remoteIp: string | null, fetcher: typeof fetch = fetch): Promise<TurnstileResult> {
    if (!secret)
        return 'unconfigured';
    if (typeof token !== 'string' || !token || token.length > 2048)
        return 'failed';
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (remoteIp)
        form.append('remoteip', remoteIp);
    try {
        const res = await fetcher(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
        if (!res.ok)
            return 'unavailable';
        const data = await res.json() as { success?: boolean };
        return data.success === true ? 'ok' : 'failed';
    }
    catch {
        return 'unavailable';
    }
}
