'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { EMIRATES } from '@/lib/catalog';
import { BROWSE_CATEGORIES, browseHref } from '@/lib/browsing';

export function BrowseLocations() {
    const [selected, setSelected] = useState(0);
    const [enhanced, setEnhanced] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const tabs = useRef<(HTMLButtonElement | null)[]>([]);
    useEffect(() => { setEnhanced(true); }, []);

    function select(index: number) {
        setSelected(index);
        setShowAll(false);
    }

    return <section className="home-location-browse location-tabs-section" aria-labelledby="location-browse-title">
        <span className="eyebrow">EXPLORE YOUR OPTIONS</span>
        <h2 id="location-browse-title">Explore properties and vehicles by location</h2>
        <p className="location-intro">Discover commercial properties and vehicles across the UAE.</p>
        <div className="location-tab-scroll" hidden={!enhanced || showAll}>
            <div className="location-tablist" role="tablist" aria-label="Explore by emirate" aria-orientation="horizontal">
                {EMIRATES.map((emirate, index) => <button key={emirate} type="button" role="tab"
                    id={`location-tab-${index}`} aria-controls={`location-panel-${index}`} aria-selected={selected === index}
                    tabIndex={selected === index ? 0 : -1} ref={element => { tabs.current[index] = element; }}
                    onClick={() => select(index)} onKeyDown={event => {
                        let next: number;
                        if (event.key === 'ArrowRight') next = (index + 1) % EMIRATES.length;
                        else if (event.key === 'ArrowLeft') next = (index + EMIRATES.length - 1) % EMIRATES.length;
                        else if (event.key === 'Home') next = 0;
                        else if (event.key === 'End') next = EMIRATES.length - 1;
                        else return;
                        event.preventDefault();
                        select(next);
                        tabs.current[next]?.focus();
                    }}>{emirate}</button>)}
            </div>
        </div>
        {/* Progressive enhancement: the same 21 anchors form a visible directory
            on the server/without JS and can be revealed together after hydration. */}
        <div className="location-panels" data-directory={!enhanced || showAll ? 'true' : 'false'}>
            {EMIRATES.map((emirate, index) => <div key={emirate} id={`location-panel-${index}`}
                className="location-panel" role={enhanced && !showAll ? 'tabpanel' : 'region'}
                aria-labelledby={enhanced && !showAll ? `location-tab-${index}` : `location-heading-${index}`}
                hidden={enhanced && !showAll && selected !== index}>
                <h3 id={`location-heading-${index}`}>{emirate}</h3>
                <ul>{BROWSE_CATEGORIES.map(category => <li key={category.id}>
                    <a href={browseHref(category.path, category.intent, emirate)}>
                        <span>{category.locationLabel} in {emirate}</span><ArrowUpRight size={18} aria-hidden="true"/>
                    </a>
                </li>)}</ul>
            </div>)}
        </div>
        <button type="button" className="location-directory-toggle" hidden={!enhanced}
            aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show selected emirate' : 'Show all locations'}
        </button>
    </section>;
}
