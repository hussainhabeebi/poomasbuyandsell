import type { Metadata } from 'next';
import './globals.css';
import { Header, Footer } from '@/components/marketplace';
import { viewer, jsonLd } from '@/lib/pages';
import { SITE_URL } from '@/lib/catalog';
export const metadata: Metadata = { metadataBase: new URL(SITE_URL), title: { default: 'Poomas Buy & Sell | UAE Commercial Properties & Vehicles', template: '%s | Poomas Buy & Sell' }, description: 'Discover commercial properties and vehicles across the UAE. List your property or vehicle, connect with buyers, and book Instagram promotions with Ajeesh.', icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' }, robots: { index: true, follow: true }, applicationName: 'Poomas Buy & Sell' };
export default async function Layout({ children }: {
    children: React.ReactNode;
}) { const v = await viewer(); return <html lang="en-AE"><body><a className="skip-link" href="#main">Skip to content</a><Header viewer={v}/><main id="main">{children}</main><Footer /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Poomas Buy & Sell', url: SITE_URL }) }}/></body></html>; }
