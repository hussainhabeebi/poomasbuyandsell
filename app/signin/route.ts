import { CALLBACK_PATH, getUser, OAUTH_STATE_COOKIE, safeRelativeReturnPath } from '@/app/auth';
import { setting } from '@/lib/server';
import { randomToken } from '@/lib/session';
// Starts Sign in with Google (authorization code flow with PKCE). The state,
// PKCE verifier and return path live in a short-lived HttpOnly cookie that
// only the callback reads.
export async function GET(request: Request) {
    const url = new URL(request.url);
    const returnTo = safeRelativeReturnPath(url.searchParams.get('return_to'));
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    if (await getUser()) {
        headers.set('Location', returnTo);
        return new Response(null, { status: 302, headers });
    }
    const clientId = setting('GOOGLE_CLIENT_ID');
    if (!clientId || !setting('GOOGLE_CLIENT_SECRET') || !setting('SESSION_SECRET')) {
        headers.set('Content-Type', 'text/plain; charset=utf-8');
        return new Response('Sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET for this deployment.', { status: 503, headers });
    }
    const state = randomToken(), verifier = randomToken();
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({ client_id: clientId, redirect_uri: url.origin + CALLBACK_PATH, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    headers.set('Set-Cookie', `${OAUTH_STATE_COOKIE}=${encodeURIComponent(JSON.stringify({ state, verifier, returnTo }))}; Path=/auth/google; Max-Age=600; HttpOnly; SameSite=Lax${secure}`);
    headers.set('Location', google.toString());
    return new Response(null, { status: 302, headers });
}
