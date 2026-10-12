import { accessAudience, accessTeamDomain, getUser, safeRelativeReturnPath, signInPath } from '@/app/cloudflare-auth';
// Cloudflare Access protects this path, so visitors arrive here only after
// signing in at the Access login page. The CF_Authorization cookie Access sets
// then authenticates the rest of the site.
export async function GET(request: Request) {
    const url = new URL(request.url);
    const returnTo = safeRelativeReturnPath(url.searchParams.get('return_to'));
    const headers = { 'Cache-Control': 'private, no-store' };
    if (await getUser())
        return new Response(null, { status: 302, headers: { ...headers, Location: returnTo } });
    const domain = accessTeamDomain(), audience = accessAudience();
    if (!domain || !audience)
        return new Response('Sign-in is not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD for this deployment.', { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
    const login = new URL(`https://${domain}/cdn-cgi/access/login/${url.host}`);
    login.searchParams.set('kid', audience);
    login.searchParams.set('redirect_url', signInPath(returnTo));
    return new Response(null, { status: 302, headers: { ...headers, Location: login.toString() } });
}
