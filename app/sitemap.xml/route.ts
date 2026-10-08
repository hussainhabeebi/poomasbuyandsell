import { database } from '@/lib/server';
import { GUIDES, SITE_URL } from '@/lib/catalog';
export const dynamic = 'force-dynamic';
const escape = (x: string) => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export async function GET() { const paths = ['', '/properties', '/vehicles', '/promote', '/sell', '/guides', '/safety', ...GUIDES.map(g => `/guides/${g.slug}`)]; let listingUrls = ''; try {
    const r = await database().prepare("SELECT slug,updated_at FROM listings WHERE status='published' ORDER BY updated_at DESC LIMIT 40000").all<{
        slug: string;
        updated_at: string;
    }>();
    listingUrls = r.results.map(l => `<url><loc>${escape(SITE_URL + '/listing/' + l.slug)}</loc><lastmod>${escape(l.updated_at)}</lastmod></url>`).join('');
}
catch (e) {
    console.error('Sitemap inventory unavailable', e);
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Retry-After': '60' } });
} return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${SITE_URL + p}</loc></url>`).join('')}${listingUrls}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public,max-age=300' } }); }
