import { EMIRATES } from './catalog.ts';

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

export function readBrowseFilters(params: URLSearchParams) {
    const intent = params.get('intent') || '';
    const emirate = params.get('emirate') || '';
    return {
        query: params.get('q') || '',
        emirate: EMIRATES.includes(emirate) ? emirate : '',
        intent: intent === 'sale' || intent === 'rent' ? intent : '',
    };
}
