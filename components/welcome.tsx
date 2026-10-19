import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { BrowseCategories, BusinessCategories, EmirateCards, BrowseLocations } from '@/components/home-browsing';

export function Welcome() {
    return <>
        <section className="welcome-page category-welcome" aria-labelledby="welcome-title">
            <div className="welcome-intro">
                <span className="eyebrow"><span className="welcome-dot"/> YOUR UAE MARKETPLACE</span>
                <h1 id="welcome-title">Your next opportunity.<br/><span>Across the UAE.</span></h1>
                <p>Explore commercial properties, shops and vehicles. Choose what you’re looking for, then find the right location for you.</p>
                <Link href="/marketplace" className="button primary welcome-browse-all">Browse All UAE<ArrowUpRight size={19} aria-hidden="true"/></Link>
            </div>
            <BrowseCategories/>
            <BusinessCategories/>
            <section className="welcome-locations" aria-labelledby="welcome-location-title">
                <div className="welcome-location-heading"><h2 id="welcome-location-title"><MapPin size={20} aria-hidden="true"/> Have a location in mind?</h2><span>Browse all UAE, or choose an emirate.</span></div>
                <EmirateCards/>
            </section>
        </section>
        <div className="container welcome-directory"><BrowseLocations/></div>
    </>;
}
