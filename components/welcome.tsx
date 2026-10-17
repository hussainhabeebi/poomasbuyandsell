import Link from 'next/link';
import { ArrowUpRight, MapPin, Building2, Car } from 'lucide-react';
import { EmirateCards, BrowseLocations } from '@/components/home-browsing';

export function Welcome() {
    return <>
        <section className="welcome-page" aria-labelledby="welcome-title">
            <div className="welcome-intro">
                <span className="eyebrow"><span className="welcome-dot"/> YOUR UAE MARKETPLACE</span>
                <h1 id="welcome-title">Good things.<br/><span>Closer to you.</span></h1>
                <p>Find a commercial space for your next move, or a vehicle for the road ahead. Start with your emirate.</p>
                <div className="welcome-categories" aria-label="What you can discover"><span><Building2 size={17} aria-hidden="true"/>Commercial property</span><span><Car size={18} aria-hidden="true"/>Vehicles for sale</span></div>
            </div>
            <section className="welcome-destinations" aria-labelledby="welcome-location-title">
                <div className="welcome-location-heading"><h2 id="welcome-location-title"><MapPin size={21} aria-hidden="true"/> Where would you like to explore?</h2><span>Seven emirates. Your choice.</span></div>
                <EmirateCards welcome/>
                <Link href="/marketplace" className="welcome-all"><span><strong>Browse All UAE</strong><span>See commercial properties and vehicles across every emirate.</span></span><ArrowUpRight size={24} aria-hidden="true"/></Link>
            </section>
        </section>
        <div className="container welcome-directory"><BrowseLocations/></div>
    </>;
}
