import Link from 'next/link';
import { ArrowUpRight, Building2, Car, KeyRound, MapPin } from 'lucide-react';
import { EMIRATES } from '@/lib/catalog';
import { BROWSE_CATEGORIES, browseHref } from '@/lib/browsing';

export function BrowseCategories() {
    return <section className="home-category-browse" aria-labelledby="category-browse-title">
        <div className="section-heading"><div><span className="eyebrow">TWO WORLDS. ONE MARKETPLACE.</span><h2 id="category-browse-title">Browse by Category</h2></div></div>
        <div className="home-category-grid">{BROWSE_CATEGORIES.map(category => <Link key={category.id} href={browseHref(category.path, category.intent)} className="home-category-card">
            <div className={`category-illustration ${category.id}`} aria-hidden="true"><span className="illustration-disc"/>{category.id === 'vehicle-sale' ? <Car strokeWidth={1.3}/> : <Building2 strokeWidth={1.3}/>}<span className="illustration-accent">{category.intent === 'rent' ? <KeyRound/> : <ArrowUpRight/>}</span></div>
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
