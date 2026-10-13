import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { EMIRATES } from '@/lib/catalog';
import { BROWSE_CATEGORIES, browseHref } from '@/lib/browsing';

const CATEGORY_PHOTOS = {
    'property-sale': { name: 'commercial-building', alt: 'Modern glass commercial building exterior' },
    'property-rent': { name: 'office-interior', alt: 'Modern office interior with glass partitions and lounge seating' },
    'vehicle-sale': { name: 'premium-suv', alt: 'Premium black SUV beside a tree-lined road' },
} as const;

export function BrowseCategories() {
    return <section className="home-category-browse" aria-labelledby="category-browse-title">
        <div className="section-heading"><div><span className="eyebrow">TWO WORLDS. ONE MARKETPLACE.</span><h2 id="category-browse-title">Browse by Category</h2></div></div>
        <div className="home-category-grid">{BROWSE_CATEGORIES.map(category => <Link key={category.id} href={browseHref(category.path, category.intent)} className="home-category-card">
            <div className="category-photo"><img src={`/images/categories/${CATEGORY_PHOTOS[category.id].name}-960.webp`} srcSet={`/images/categories/${CATEGORY_PHOTOS[category.id].name}-480.webp 480w, /images/categories/${CATEGORY_PHOTOS[category.id].name}-960.webp 960w`} sizes="(max-width: 650px) 100px, (max-width: 1024px) 30vw, 400px" alt={CATEGORY_PHOTOS[category.id].alt} width={960} height={600} loading="lazy" decoding="async"/></div>
            <div className="home-category-label"><h3>{category.label}</h3><ArrowUpRight size={21} aria-hidden="true"/></div>
        </Link>)}</div>
    </section>;
}

export function BrowseEmirates() {
    return <section className="home-emirate-browse" aria-labelledby="emirate-browse-title">
        <div className="section-heading"><div><span className="eyebrow">FIND YOUR PLACE</span><h2 id="emirate-browse-title">Explore listings across the UAE</h2></div></div>
        <ul className="home-emirate-grid">{EMIRATES.map(emirate => <li key={emirate}><Link href={browseHref('/', '', emirate) + '#browse'} className="home-emirate-card"><MapPin size={22} aria-hidden="true"/><span>{emirate}</span><ArrowUpRight size={17} aria-hidden="true"/></Link></li>)}</ul>
    </section>;
}

export function BrowseLocations() {
    return <section className="home-location-browse" aria-labelledby="location-browse-title">
        <span className="eyebrow">EXPLORE YOUR OPTIONS</span><h2 id="location-browse-title">Explore properties and vehicles by location</h2>
        <div className="home-location-grid">{EMIRATES.map(emirate => <nav key={emirate} aria-label={`Listings in ${emirate}`}><h3>{emirate}</h3><ul>{BROWSE_CATEGORIES.map(category => <li key={category.id}><Link href={browseHref(category.path, category.intent, emirate)}>{category.locationLabel} in {emirate}</Link></li>)}</ul></nav>)}</div>
    </section>;
}
