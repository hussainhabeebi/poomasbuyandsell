import Link from 'next/link';
import { ArrowUpRight, MapPin, ShoppingBasket, Coffee, ShoppingCart, Scissors, Hammer, Shirt } from 'lucide-react';
import { EMIRATES, BUSINESS_TYPES } from '@/lib/catalog';
import { BROWSE_CATEGORIES, browseHref, marketplaceFilterHref, readMarketplaceFilters } from '@/lib/browsing';
export { BrowseLocations } from './location-browse';

const CATEGORY_PHOTOS = {
    'property-sale': { name: 'commercial-building', alt: 'Modern glass commercial building exterior' },
    'property-rent': { name: 'office-interior', alt: 'Modern office interior with glass partitions and lounge seating' },
    'vehicle-sale': { name: 'premium-suv', alt: 'Premium black SUV beside a tree-lined road' },
} as const;

export function BrowseCategories({ emirate = '' }: { emirate?: string }) {
    return <section className="home-category-browse" aria-labelledby="category-browse-title">
        <div className="section-heading"><div><span className="eyebrow">TWO WORLDS. ONE MARKETPLACE.</span><h2 id="category-browse-title">Browse by Category</h2></div></div>
        <div className="home-category-grid">{BROWSE_CATEGORIES.map(category => <Link key={category.id} href={browseHref(category.path, category.intent, emirate)} className="home-category-card">
            <div className="category-photo"><img src={`/images/categories/${CATEGORY_PHOTOS[category.id].name}-960.webp`} srcSet={`/images/categories/${CATEGORY_PHOTOS[category.id].name}-480.webp 480w, /images/categories/${CATEGORY_PHOTOS[category.id].name}-960.webp 960w`} sizes="(max-width: 650px) 100px, (max-width: 1024px) 30vw, 400px" alt={CATEGORY_PHOTOS[category.id].alt} width={960} height={600} loading="lazy" decoding="async"/></div>
            <div className="home-category-label"><h3>{category.label}</h3><ArrowUpRight size={21} aria-hidden="true"/></div>
        </Link>)}</div>
    </section>;
}

const BUSINESS_ICONS = [ShoppingBasket, Coffee, ShoppingCart, Scissors, Hammer, Shirt];

export function BusinessCategories({ search = '' }: { search?: string }) {
    const selected = readMarketplaceFilters(new URLSearchParams(search), 'property');
    return <section className="business-browse" aria-labelledby="business-browse-title">
        <div className="business-heading"><h2 id="business-browse-title">Shops &amp; businesses for sale</h2><p>Explore by business type. Check each listing for what’s included.</p></div>
        <ul className="business-links">{BUSINESS_TYPES.map((type, index) => {
            const Icon = BUSINESS_ICONS[index];
            const href = marketplaceFilterHref(`/properties${search ? `?${search}` : ''}`, { tab: 'property', type, intent: 'sale' }, 'property');
            return <li key={type}><Link href={href} aria-current={selected.type === type && selected.intent === 'sale' ? 'page' : undefined}><Icon size={23} aria-hidden="true"/><span>{type}</span><ArrowUpRight size={17} aria-hidden="true"/></Link></li>;
        })}</ul>
    </section>;
}

// Location is optional navigation, not a photographic gate into the marketplace.
export function EmirateCards({ search = '' }: { search?: string }) {
    return <ul className="emirate-links">{EMIRATES.map(emirate => <li key={emirate}>
        <Link href={marketplaceFilterHref(`/marketplace${search ? `?${search}` : ''}`, { emirate })}>
            <MapPin size={16} aria-hidden="true"/><span>{emirate}</span><ArrowUpRight size={15} aria-hidden="true"/>
        </Link>
    </li>)}</ul>;
}

export function BrowseEmirates({ search = '' }: { search?: string }) {
    return <section className="home-emirate-browse" aria-labelledby="emirate-browse-title">
        <div className="section-heading"><div><span className="eyebrow">FIND YOUR PLACE</span><h2 id="emirate-browse-title">Explore listings across the UAE</h2></div></div>
        <EmirateCards search={search}/>
    </section>;
}
