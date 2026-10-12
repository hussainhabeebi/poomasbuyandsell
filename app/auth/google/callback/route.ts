import { CALLBACK_PATH, OAUTH_STATE_COOKIE, readCookie, safeRelativeReturnPath, SESSION_COOKIE } from '@/app/auth';
import { setting } from '@/lib/server';
import { googleIdTokenUser, SESSION_TTL_SECONDS, signSession } from '@/lib/session';
// Google returns here after sign-in. The code is exchanged server-side for the
// account's ID token, and the verified account is stored in a signed session.
export async function GET(request: Request) {
    const url = new URL(request.url);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    headers.append('Set-Cookie', `${OAUTH_STATE_COOKIE}=; Path=/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
    const fail = (message: string, status = 400) => { headers.set('Content-Type', 'text/plain; charset=utf-8'); return new Response(`${message} Please go back and try signing in again.`, { status, headers }); };
    let saved: { state?: string; verifier?: string; returnTo?: string } = {};
    try {
        saved = JSON.parse(decodeURIComponent(readCookie(request.headers.get('cookie'), OAUTH_STATE_COOKIE) || '{}'));
    }
    catch {
        return fail('Your sign-in session expired.');
    }
    const returnTo = safeRelativeReturnPath(saved.returnTo);
    if (url.searchParams.get('error')) {
        headers.set('Location', returnTo);
        return new Response(null, { status: 302, headers });
    }
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (!code || !state || !saved.state || !saved.verifier || state !== saved.state)
        return fail('Your sign-in session expired.');
    const clientId = setting('GOOGLE_CLIENT_ID'), clientSecret = setting('GOOGLE_CLIENT_SECRET'), secret = setting('SESSION_SECRET');
    if (!clientId || !clientSecret || !secret)
        return fail('Sign-in is not configured.', 503);
    let idToken = '';
    try {
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: url.origin + CALLBACK_PATH, grant_type: 'authorization_code', code_verifier: saved.verifier }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            console.error('Google token exchange failed', response.status, await response.text());
            return fail('Google sign-in could not be completed.', 502);
        }
        idToken = ((await response.json()) as { id_token?: string }).id_token || '';
    }
    catch (error) {
        console.error('Google token exchange failed', error);
        return fail('Google sign-in could not be completed.', 502);
    }
    const user = googleIdTokenUser(idToken, clientId);
    if (!user)
        return fail('This Google account could not be verified. Use an account with a verified email address.', 403);
    headers.append('Set-Cookie', `${SESSION_COOKIE}=${await signSession(user, secret)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
    headers.set('Location', returnTo);
    return new Response(null, { status: 302, headers });
}
