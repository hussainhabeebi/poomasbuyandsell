import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { crmDb } from '@/lib/crm/server';
import { publicListings } from '@/lib/crm/repo';
import { meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Businesses for Sale in the UAE', 'Verified businesses for sale through Poomas FZE LLC. Enquire to receive full details.', '/businesses-for-sale');
const aed = (n: unknown) => n == null ? null : new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(n));
export default async function Page() {
    let listings: Record<string, unknown>[] = [], error = '';
    try {
        listings = await publicListings(crmDb());
    }
    catch (e) {
        console.error('Business listings unavailable', e);
        error = 'Business listings are temporarily unavailable. Please try again shortly.';
    }
    return <div className="container page-space">
        <span className="eyebrow">POOMAS FZE LLC</span><h1>Businesses for sale</h1>
        <p>Every business shown here has been verified by our team. Enquire with the listing ID to receive full details.</p>
        <p><Link className="button primary small" href="/enquiry/buyer">Tell us what you are looking for</Link> <Link className="button outline small" href="/enquiry/seller">Sell your business</Link></p>
        {error && <p className="error notice">{error}</p>}
        {!error && !listings.length && <div className="empty-state"><h3>No businesses listed right now</h3><p>Send a buyer enquiry and we will contact you when a suitable business becomes available.</p></div>}
        <div className="listing-grid" style={{ marginTop: 30 }}>{listings.map(l => <article className="listing-card" key={String(l.code)}><div className="card-body">
            <span className="status">{String(l.code)}</span>
            <h3 style={{ marginTop: 10 }}>{String(l.business_name)}</h3>
            <div className="card-location"><MapPin size={13} aria-hidden="true" />{[l.area, l.emirate].filter(Boolean).join(', ')} · {String(l.category)}</div>
            {l.description ? <p style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{String(l.description).slice(0, 400)}</p> : null}
            <div className="card-bottom"><strong>{aed(l.asking_price) ?? 'Price on request'}</strong>{l.monthly_rent != null && <span>RENT {aed(l.monthly_rent)}/MONTH</span>}</div>
        </div></article>)}</div>
        <p className="muted" style={{ marginTop: 30 }}>Listing information is provided by sellers and verified for ownership and authorization only. It is not a valuation or a guarantee of financial performance.</p>
    </div>;
}
