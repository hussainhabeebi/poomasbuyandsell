import { EMIRATES, TYPES } from './catalog.ts';

export const BROWSE_CATEGORIES = [
    { id: 'property-sale', label: 'Commercial Property for Sale', locationLabel: 'Commercial Properties for Sale', path: '/properties', intent: 'sale' },
    { id: 'property-rent', label: 'Commercial Property for Rent', locationLabel: 'Commercial Properties for Rent', path: '/properties', intent: 'rent' },
    { id: 'vehicle-sale', label: 'Vehicles for Sale', locationLabel: 'Vehicles for Sale', path: '/vehicles', intent: 'sale' },
] as const;

export function browseHref(path: string, intent = '', emirate = '') {
    const params = new URLSearchParams();
    if (intent) params.set('intent', intent);
    if (emirate) params.set('emirate', emirate);
    return `${path}${params.size ? `?${params}` : ''}`;
}

export type MarketplaceFilters = {
    query: string;
    tab: string;
    emirate: string;
    type: string;
    intent: string;
    max: string;
    sort: string;
};

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilters = {
    query: '', tab: 'all', emirate: '', type: '', intent: '', max: '', sort: 'newest',
};

export function marketplacePurposes(tab: string) {
    return [
        { value: '', label: tab === 'vehicle' ? 'All vehicle sales' : 'Sale & rent' },
        { value: 'sale', label: 'For sale' },
        ...(tab === 'vehicle' ? [] : [{ value: 'rent', label: 'For rent' }]),
    ];
}

export function readMarketplaceFilters(params: URLSearchParams, category?: 'property' | 'vehicle'): MarketplaceFilters {
    const selected = params.get('category');
    const tab = category || (selected === 'property' || selected === 'vehicle' ? selected : 'all');
    const type = params.get('type') || '';
    const types = tab === 'all' ? [...TYPES.property, ...TYPES.vehicle] : TYPES[tab as 'property' | 'vehicle'];
    const max = params.get('max') || '';
    const sort = params.get('sort');
    const browse = readBrowseFilters(params);
    return {
        ...browse, tab,
        intent: tab === 'vehicle' && browse.intent === 'rent' ? '' : browse.intent,
        type: types.includes(type) ? type : '',
        max: max.trim() && Number.isFinite(Number(max)) && Number(max) >= 0 ? max : '',
        sort: sort === 'low' || sort === 'high' ? sort : 'newest',
    };
}

// Only replace marketplace-owned parameters; keep campaign parameters and anchors.
export function marketplaceFilterHref(href: string, change: Partial<MarketplaceFilters>, category?: 'property' | 'vehicle') {
    const url = new URL(href, 'https://www.poomasbuyandsell.com');
    const next = { ...readMarketplaceFilters(url.searchParams, category), ...change };
    if ((category || next.tab) === 'vehicle' && next.intent === 'rent') next.intent = '';
    const tab = category || next.tab;
    const types = tab === 'all' ? [...TYPES.property, ...TYPES.vehicle] : TYPES[tab as 'property' | 'vehicle'];
    if (!types.includes(next.type)) next.type = '';
    const keys = { query: 'q', tab: 'category', emirate: 'emirate', type: 'type', intent: 'intent', max: 'max', sort: 'sort' } as const;
    for (const key of Object.keys(keys) as (keyof MarketplaceFilters)[]) {
        url.searchParams.delete(keys[key]);
        if (next[key] !== DEFAULT_MARKETPLACE_FILTERS[key] && !(key === 'tab' && category)) {
            url.searchParams.set(keys[key], next[key]);
        }
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

export function readBrowseFilters(params: URLSearchParams) {
    const intent = params.get('intent') || '';
    const emirate = params.get('emirate') || '';
    return {
        query: params.get('q') || '',
        emirate: EMIRATES.includes(emirate) ? emirate : '',
        intent: intent === 'sale' || intent === 'rent' ? intent : '',
    };
}
