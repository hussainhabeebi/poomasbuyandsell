// Keep existing bookmarked homepage searches working without touching listing routes.
const FILTER_KEYS = ['q', 'category', 'emirate', 'type', 'intent', 'max', 'sort'];
const BROWSE_ANCHORS = ['#browse', '#category-browse-title', '#emirate-browse-title'];

export function legacyMarketplaceHref(href: string): string | null {
    const url = new URL(href, 'https://www.poomasbuyandsell.com');
    if (url.pathname !== '/' || (!FILTER_KEYS.some(key => url.searchParams.has(key)) && !BROWSE_ANCHORS.includes(url.hash))) return null;
    return `/marketplace${url.search}${url.hash}`;
}
