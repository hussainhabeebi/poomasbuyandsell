import test from 'node:test';
import assert from 'node:assert/strict';
import { EMIRATES } from '../lib/catalog.ts';
import { BROWSE_CATEGORIES, browseHref, readBrowseFilters } from '../lib/browsing.ts';

test('all category and emirate links retain their supported category, purpose and emirate', () => {
    assert.equal(BROWSE_CATEGORIES.length, 3);
    assert.equal(EMIRATES.length, 7);
    for (const category of BROWSE_CATEGORIES) {
        for (const emirate of ['', ...EMIRATES]) {
            const url = new URL(browseHref(category.path, category.intent, emirate), 'https://www.poomasbuyandsell.com');
            assert.equal(url.pathname, category.id === 'vehicle-sale' ? '/vehicles' : '/properties');
            assert.deepEqual(readBrowseFilters(url.searchParams), { query: '', intent: category.intent, emirate });
        }
    }
    for (const emirate of EMIRATES) {
        const url = new URL(browseHref('/', '', emirate) + '#browse', 'https://www.poomasbuyandsell.com');
        assert.equal(url.hash, '#browse');
        assert.equal(readBrowseFilters(url.searchParams).emirate, emirate);
    }
});
test('linked filters retain keyword search and reject unsupported location and purpose', () => {
    assert.deepEqual(readBrowseFilters(new URLSearchParams('q=office&emirate=Abu+Dhabi&intent=rent')), { query: 'office', emirate: 'Abu Dhabi', intent: 'rent' });
    assert.deepEqual(readBrowseFilters(new URLSearchParams('emirate=Al+Ain&intent=holiday')), { query: '', emirate: '', intent: '' });
});

import { DEFAULT_MARKETPLACE_FILTERS, marketplaceFilterHref, readMarketplaceFilters } from '../lib/browsing.ts';

test('multiple filters round-trip through the URL and preserve unrelated parameters and anchors', () => {
    const filters = { query: 'office & parking', tab: 'property', emirate: 'Abu Dhabi', type: 'Office', intent: 'rent', max: '100000', sort: 'low' };
    const href = marketplaceFilterHref('/?utm_source=campaign&tag=a&tag=b#browse', filters);
    const url = new URL(href, 'https://www.poomasbuyandsell.com');
    assert.deepEqual(readMarketplaceFilters(url.searchParams), filters);
    assert.equal(url.searchParams.get('utm_source'), 'campaign');
    assert.deepEqual(url.searchParams.getAll('tag'), ['a', 'b']);
    assert.equal(url.hash, '#browse');
    assert.equal(marketplaceFilterHref(href, filters), href);
});

test('reset removes every owned filter including category and sort; refresh reads defaults', () => {
    const href = marketplaceFilterHref('/?category=property&q=office&emirate=Dubai&type=Office&intent=rent&max=50000&sort=high&utm_source=ad#browse', DEFAULT_MARKETPLACE_FILTERS);
    assert.equal(href, '/?utm_source=ad#browse');
    assert.deepEqual(readMarketplaceFilters(new URL(href, 'https://example.com').searchParams), DEFAULT_MARKETPLACE_FILTERS);
});

test('individual updates keep other filters and history snapshots restore each state', () => {
    const first = marketplaceFilterHref('/', { tab: 'property', type: 'Office' });
    const second = marketplaceFilterHref(first, { emirate: 'Dubai', intent: 'rent' });
    const reset = marketplaceFilterHref(second, DEFAULT_MARKETPLACE_FILTERS);
    const read = (href: string) => readMarketplaceFilters(new URL(href, 'https://example.com').searchParams);
    assert.equal(read(first).type, 'Office');
    assert.equal(read(second).type, 'Office');
    assert.equal(read(second).emirate, 'Dubai');
    assert.equal(read(second).intent, 'rent');
    assert.deepEqual(read(reset), DEFAULT_MARKETPLACE_FILTERS);
    assert.equal(read(first).emirate, '');
    assert.equal(read(second).emirate, 'Dubai');
});

test('category routes remain scoped after reset and category changes discard incompatible types', () => {
    const href = marketplaceFilterHref('/properties?category=vehicle&emirate=Dubai&intent=rent', DEFAULT_MARKETPLACE_FILTERS, 'property');
    assert.equal(href, '/properties');
    assert.equal(readMarketplaceFilters(new URLSearchParams(), 'property').tab, 'property');
    const changed = marketplaceFilterHref('/?category=property&type=Office&emirate=Dubai', { tab: 'vehicle', type: '' });
    assert.equal(readMarketplaceFilters(new URL(changed, 'https://example.com').searchParams).type, '');
    assert.equal(readMarketplaceFilters(new URL(changed, 'https://example.com').searchParams).emirate, 'Dubai');
});

test('invalid filter values cannot select unsupported categories, types, prices or sort order', () => {
    assert.deepEqual(readMarketplaceFilters(new URLSearchParams('category=jobs&type=Room&emirate=Al+Ain&intent=holiday&max=-1&sort=random')), DEFAULT_MARKETPLACE_FILTERS);
    assert.equal(readMarketplaceFilters(new URLSearchParams('max=Infinity')).max, '');
    assert.equal(readMarketplaceFilters(new URLSearchParams('max=0')).max, '0');
});
