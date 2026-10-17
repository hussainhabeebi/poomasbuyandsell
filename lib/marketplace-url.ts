// Browsing uses shallow history updates. Read the real URL rather than the
// router's cached search snapshot, which can remain stale on history traversal.
const MARKETPLACE_URL_CHANGE = 'poomas:marketplace-url-change';
type BrowserUrl = Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;

export function marketplaceSearchSnapshot(browser: BrowserUrl = window) {
    return browser.location.search;
}

export function subscribeMarketplaceUrl(listener: () => void, browser: BrowserUrl = window) {
    browser.addEventListener('popstate', listener);
    browser.addEventListener('pageshow', listener);
    browser.addEventListener(MARKETPLACE_URL_CHANGE, listener);
    return () => {
        browser.removeEventListener('popstate', listener);
        browser.removeEventListener('pageshow', listener);
        browser.removeEventListener(MARKETPLACE_URL_CHANGE, listener);
    };
}

export function writeMarketplaceHref(href: string, replace = false, browser: BrowserUrl = window) {
    const { pathname, search, hash } = browser.location;
    if (href === `${pathname}${search}${hash}`) return;
    // Retain router/scroll metadata; never manufacture a popstate event or add
    // history entries while merely reading a traversed URL.
    browser.history[replace ? 'replaceState' : 'pushState'](browser.history.state, '', href);
    browser.dispatchEvent(new Event(MARKETPLACE_URL_CHANGE));
}
