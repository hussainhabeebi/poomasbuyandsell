import { SITE_URL } from '@/lib/catalog';
export async function GET() { return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/media/\nDisallow: /account\nDisallow: /admin\nDisallow: /signin-with-chatgpt\nDisallow: /signout-with-chatgpt\nDisallow: /callback\nDisallow: /*?\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } }); }
