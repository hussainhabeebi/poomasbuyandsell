import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin, Play } from 'lucide-react';
import { database } from '@/lib/server';
import { decodeListing, publicListing, SITE_URL } from '@/lib/catalog';
import { Gallery, DetailActions } from '@/components/marketplace';
import { meta, viewer, jsonLd } from '@/lib/pages';
export const dynamic = 'force-dynamic';
async function listing(slug: string) { return database().prepare("SELECT * FROM listings WHERE slug=? AND status IN ('published','sold')").bind(slug).first<Record<string, unknown>>(); }
export async function generateMetadata({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) { const { slug } = await params; try {
    const row = await listing(slug);
    if (!row)
        return meta('Listing Not Found', 'This listing is unavailable.', `/listing/${slug}`, true);
    const l = decodeListing(row);
    return meta(`${l.title} in ${l.emirate}`, l.description.slice(0, 155), `/listing/${slug}`, l.status === 'sold');
}
catch {
    return meta('Listing Unavailable', 'Please try again later.', `/listing/${slug}`, true);
} }
export default async function Page({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) { const { slug } = await params; let row; try {
    row = await listing(slug);
}
catch {
    return <div className="container page-space storage-warning"><h1>Listing temporarily unavailable.</h1><p>Please try again shortly.</p></div>;
} if (!row)
    notFound(); const l = decodeListing(row), v = await viewer(); const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL }, { '@type': 'ListItem', position: 2, name: l.category === 'property' ? 'Commercial properties' : 'Vehicles', item: SITE_URL + (l.category === 'property' ? '/properties' : '/vehicles') }, { '@type': 'ListItem', position: 3, name: l.title, item: `${SITE_URL}/listing/${l.slug}` }] }; const schema = l.category === 'vehicle' ? { '@context': 'https://schema.org', '@type': 'Vehicle', name: l.title, description: l.description, image: l.images.map(x => SITE_URL + x), offers: { '@type': 'Offer', price: l.price, priceCurrency: 'AED', availability: l.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock', url: `${SITE_URL}/listing/${l.slug}` } } : { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: l.title, description: l.description, url: `${SITE_URL}/listing/${l.slug}`, datePosted: l.created_at, offers: { '@type': 'Offer', price: l.price, priceCurrency: 'AED', businessFunction: l.intent === 'rent' ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell' } }; return <div className="container page-space"><div className="breadcrumbs"><Link href="/">Home</Link><span>/</span><Link href={l.category === 'property' ? '/properties' : '/vehicles'}>{l.category === 'property' ? 'Properties' : 'Vehicles'}</Link><span>/</span><span>{l.title}</span></div><div className="detail-layout"><div className="detail-main"><Gallery images={l.images} title={l.title}/><h1>{l.title}</h1><div className="detail-meta"><MapPin size={17}/>{l.area}, {l.emirate}<span>·</span>{l.subtype}<span>·</span>{l.status === 'sold' ? 'Sold' : l.intent === 'rent' ? 'For rent' : 'For sale'}</div>{l.video && <a className="button outline small" style={{ marginTop: 20 }} href={l.video} target="_blank" rel="noopener noreferrer"><Play size={16}/>Watch listing video</a>}<section className="detail-section"><h2>The details</h2><dl className="spec-grid">{Object.entries(l.specs).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section><section className="detail-section"><h2>About this {l.category === 'property' ? 'property' : 'vehicle'}</h2><p>{l.description}</p>{l.permit && <p>Advertising reference supplied by seller: {l.permit}</p>}</section><section className="detail-section"><h2>Before you decide</h2><p>Listing details are supplied by the seller. Confirm ownership or selling authority, documents and condition independently. A paid promotion is not a verification badge.</p><Link className="text-link" href={`/guides/${l.category === 'property' ? 'commercial-property-viewing-checklist' : 'used-vehicle-viewing-checklist'}`}>Read the {l.category === 'property' ? 'property viewing' : 'vehicle buying'} checklist</Link></section></div><DetailActions listing={{ ...publicListing(l), phone: l.status === 'published' ? l.phone : undefined }} viewer={v}/></div><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }}/><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(schema) }}/></div>; }
