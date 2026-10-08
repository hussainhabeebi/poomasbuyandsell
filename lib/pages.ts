import { database, isAdmin } from './server';
import { decodeListing, publicListing, Listing, SITE_URL } from './catalog';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import type { Viewer } from '@/components/marketplace';
import type { Metadata } from 'next';
export async function viewer(): Promise<Viewer> { const u = await getChatGPTUser(); return u ? { name: u.displayName, email: u.email, admin: isAdmin(u.email) } : null; }
export async function inventory(): Promise<{
    listings: Listing[];
    error?: string;
}> { try {
    const rows = await database().prepare("SELECT * FROM listings WHERE status='published' ORDER BY created_at DESC LIMIT 200").all();
    return { listings: rows.results.map(r => publicListing(decodeListing(r))) };
}
catch (e) {
    console.error('Inventory unavailable', e);
    return { listings: [], error: 'Listings are temporarily unavailable. Please try again shortly.' };
} }
export function meta(title: string, description: string, path: string, noindex = false): Metadata { return { title, description, alternates: { canonical: SITE_URL + path }, openGraph: { title: `${title} | Poomas Buy & Sell`, description, url: SITE_URL + path, type: 'website', siteName: 'Poomas Buy & Sell', locale: 'en_AE' }, twitter: { card: 'summary', title, description }, ...(noindex ? { robots: { index: false, follow: false } } : {}) }; }
export function jsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
