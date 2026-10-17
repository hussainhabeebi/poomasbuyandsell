import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MARKETPLACE_FILTERS, marketplaceFilterHref, marketplacePurposes, readMarketplaceFilters, type MarketplaceFilters } from '../lib/browsing.ts';
import { marketplaceSearchSnapshot, subscribeMarketplaceUrl, writeMarketplaceHref } from '../lib/marketplace-url.ts';
import { legacyMarketplaceHref } from '../lib/location-navigation.ts';

// A browser History/EventTarget fixture: writes do NOT emit popstate; traversal
// DOES. This exercises the actual production subscription, not just URL helpers.
function browserFixture(href: string, category?: 'property' | 'vehicle') {
    const target = new EventTarget();
    let entries = [new URL(href, 'https://example.test')], index = 0;
    let pushes = 0, replacements = 0;
    const metadata = { router: 'preserve', scrollY: 240 };
    const history = {
        state: metadata,
        pushState(state: unknown, _: string, href: string) {
            assert.deepEqual(state, metadata);
            entries = entries.slice(0, index + 1);
            entries.push(new URL(href, entries[index]));
            index++; pushes++;
        },
        replaceState(state: unknown, _: string, href: string) {
            assert.deepEqual(state, metadata);
            entries[index] = new URL(href, entries[index]); replacements++;
        },
    };
    const browser = Object.assign(target, { history });
    // Keep location live as the simulated history index moves.
    Object.defineProperty(browser, 'location', { get: () => entries[index] });
    const window = browser as unknown as Window;
    let visible = readMarketplaceFilters(new URLSearchParams(marketplaceSearchSnapshot(window)), category);
    let notifications = 0;
    const unsubscribe = subscribeMarketplaceUrl(() => {
        notifications++;
        visible = readMarketplaceFilters(new URLSearchParams(marketplaceSearchSnapshot(window)), category);
    }, window);
    return {
        window, unsubscribe,
        get href() { return entries[index].pathname + entries[index].search + entries[index].hash; },
        get visible() { return visible; },
        get counts() { return { pushes, replacements, notifications }; },
        change(change: Partial<MarketplaceFilters>, replace = false) {
            writeMarketplaceHref(marketplaceFilterHref(entries[index].href, change, category), replace, window);
        },
        traverse(delta: number) {
            const next = index + delta;
            assert.ok(next >= 0 && next < entries.length);
            index = next;
            target.dispatchEvent(new Event('popstate'));
        },
    };
}

function synchronized(f: ReturnType<typeof browserFixture>, expected: Partial<MarketplaceFilters>) {
    const fromUrl = readMarketplaceFilters(new URL(f.href, 'https://example.test').searchParams);
    assert.deepEqual(f.visible, fromUrl, 'visible snapshot must follow the current URL');
    for (const [key, value] of Object.entries(expected)) assert.equal(f.visible[key as keyof MarketplaceFilters], value, key);
    assert.equal(marketplacePurposes(f.visible.tab).some(x => x.value === 'rent'), f.visible.tab !== 'vehicle');
}

test('Property Rent Dubai → Vehicles → Back → Forward restores visible controls via popstate', () => {
    const f = browserFixture('/marketplace?category=property&intent=rent&emirate=Dubai&type=Office&max=50000&sort=low&utm_source=qa#browse');
    const first = f.href;
    f.change({ tab: 'vehicle' });
    synchronized(f, { tab: 'vehicle', intent: '', type: '', emirate: 'Dubai', max: '50000', sort: 'low' });
    assert.ok(!f.href.includes('intent=') && !f.href.includes('type='));
    const second = f.href;
    f.traverse(-1);
    synchronized(f, { tab: 'property', intent: 'rent', type: 'Office', emirate: 'Dubai' });
    assert.equal(f.href, first);
    f.traverse(1);
    synchronized(f, { tab: 'vehicle', intent: '', type: '' });
    assert.equal(f.href, second);
    assert.deepEqual(f.counts, { pushes: 1, replacements: 0, notifications: 3 });
    assert.ok(f.href.includes('utm_source=qa') && f.href.endsWith('#browse'));
    f.unsubscribe();
});

test('Property Sale Sharjah → Vehicles → Back retains compatible purpose, location and search', () => {
    const f = browserFixture('/marketplace?category=property&intent=sale&emirate=Sharjah&q=showroom');
    f.change({ tab: 'vehicle' });
    synchronized(f, { tab: 'vehicle', intent: 'sale', emirate: 'Sharjah', query: 'showroom' });
    f.traverse(-1);
    synchronized(f, { tab: 'property', intent: 'sale', emirate: 'Sharjah' });
    f.unsubscribe();
});

test('emirate change → Back → Forward restores the selected emirate without writes on traversal', () => {
    const f = browserFixture('/marketplace?category=property&intent=rent&emirate=Dubai');
    f.change({ emirate: 'Abu Dhabi' });
    synchronized(f, { emirate: 'Abu Dhabi', intent: 'rent' });
    f.traverse(-1); synchronized(f, { emirate: 'Dubai' });
    f.traverse(1); synchronized(f, { emirate: 'Abu Dhabi' });
    assert.equal(f.counts.pushes, 1);
    f.unsubscribe();
});

test('multiple filters → Reset → Back restores all controls; replace edits do not add history', () => {
    const f = browserFixture('/marketplace?category=property&intent=rent&emirate=Dubai&utm_source=qa#browse');
    f.change({ type: 'Office', query: 'parking', max: '100000', sort: 'high' }, true);
    const active = { ...f.visible };
    f.change(DEFAULT_MARKETPLACE_FILTERS);
    synchronized(f, DEFAULT_MARKETPLACE_FILTERS);
    assert.equal(f.href, '/marketplace?utm_source=qa#browse');
    f.traverse(-1);
    synchronized(f, active);
    assert.deepEqual(f.counts, { pushes: 1, replacements: 1, notifications: 3 });
    f.unsubscribe();
});

test('direct URL/refresh and legacy URLs derive the same filters without normalization loops', () => {
    for (const href of ['/marketplace?category=property&intent=rent&emirate=Dubai&type=Office', '/vehicles?intent=rent&emirate=Sharjah', legacyMarketplaceHref('/?category=vehicle&intent=rent&emirate=Dubai#browse')!]) {
        const category = href.startsWith('/vehicles') ? 'vehicle' : undefined;
        const f = browserFixture(href, category);
        const normalized = marketplaceFilterHref(href, {}, category);
        writeMarketplaceHref(normalized, true, f.window);
        const refreshed = browserFixture(f.href, category);
        assert.deepEqual(refreshed.visible, f.visible);
        if (category) assert.equal(refreshed.visible.tab, category);
        writeMarketplaceHref(normalized, true, f.window);
        assert.ok(f.counts.replacements <= 1);
        assert.equal(f.counts.pushes, 0);
        if (href.includes('intent=rent') && (category === 'vehicle' || href.includes('category=vehicle'))) assert.ok(!f.href.includes('intent='));
        f.unsubscribe(); refreshed.unsubscribe();
    }
});

test('repeated category switching clears only incompatible types and preserves sale and budget', () => {
    const f = browserFixture('/marketplace?category=property&intent=sale&emirate=Ajman&type=Office&max=100000');
    f.change({ tab: 'all' }); synchronized(f, { type: 'Office' });
    f.change({ tab: 'property' }); synchronized(f, { type: 'Office' });
    for (let i = 0; i < 5; i++) {
        f.change({ tab: 'vehicle' }); synchronized(f, { tab: 'vehicle', type: '', intent: 'sale', max: '100000' });
        f.change({ type: 'SUV' }); synchronized(f, { type: 'SUV' });
        f.change({ tab: 'property' }); synchronized(f, { tab: 'property', type: '', emirate: 'Ajman' });
    }
    assert.equal(f.counts.pushes, 17);
    f.unsubscribe();
});

test('unchanged URLs do not write or notify; unsubscribe cleans up traversal and bfcache listeners', () => {
    const f = browserFixture('/marketplace?emirate=Dubai');
    writeMarketplaceHref(f.href, false, f.window);
    assert.deepEqual(f.counts, { pushes: 0, replacements: 0, notifications: 0 });
    f.window.dispatchEvent(new Event('pageshow'));
    assert.equal(f.counts.notifications, 1);
    f.unsubscribe();
    f.change({ emirate: 'Sharjah' }); f.traverse(-1);
    f.window.dispatchEvent(new Event('pageshow'));
    assert.equal(f.counts.notifications, 1);
});

test('category-specific route normalization never keeps an incompatible type', () => {
    const url = marketplaceFilterHref('/properties?type=SUV&intent=rent', DEFAULT_MARKETPLACE_FILTERS, 'property');
    assert.equal(url, '/properties');
    assert.equal(marketplaceFilterHref('/marketplace?category=property&type=Office', { tab: 'all' }).includes('type=Office'), true);
});
