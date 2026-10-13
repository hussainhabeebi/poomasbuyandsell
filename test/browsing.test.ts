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
