// Cloudflare Access ends the session and clears CF_Authorization at its logout endpoint.
export async function GET() {
    return new Response(null, { status: 302, headers: { 'Cache-Control': 'private, no-store', Location: '/cdn-cgi/access/logout' } });
}
