import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { legacyMarketplaceHref } from '../lib/location-navigation.ts';
import { EMIRATES, BUSINESS_TYPES, TYPES, type Listing } from '../lib/catalog.ts';
import { BROWSE_CATEGORIES, browseHref, DEFAULT_MARKETPLACE_FILTERS, marketplaceFilterHref, readMarketplaceFilters } from '../lib/browsing.ts';

// Render the real welcome/cards/directory tree, including client components'
// initial server output. No network, database, auth or payment calls.
const modules = new Map<string, string>();
const navigationUrl = `data:text/javascript;base64,${Buffer.from(`
    let href = '/';
    export function setHref(value) { href = value; }
    export function usePathname() { return new URL(href, 'https://example.com').pathname; }
    export function useSearchParams() { return new URL(href, 'https://example.com').searchParams; }
`).toString('base64')}`;
async function moduleUrl(path: URL): Promise<string> {
    if (modules.has(path.href)) return modules.get(path.href)!;
    const source = await readFile(path, 'utf8');
    let compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const names = [...compiled.matchAll(/(?:from|import) ['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const name of new Set(names)) {
        let resolved: string;
        if (name.endsWith('.module.css')) resolved = `data:text/javascript;base64,${Buffer.from('export default {}').toString('base64')}`;
        else if (name.startsWith('../lib/')) resolved = new URL(name + '.ts', path).href;
        else if (name.startsWith('@/components/') || name.startsWith('./')) {
            const local = name.startsWith('@/') ? new URL(`../${name.slice(2)}.tsx`, import.meta.url) : new URL(`${name}.tsx`, path);
            resolved = await moduleUrl(local);
        } else if (name === '@/lib/utils') resolved = await moduleUrl(new URL('../lib/utils.ts', import.meta.url));
        else if (name === 'next/navigation') resolved = navigationUrl;
        else if (name.startsWith('@/lib/')) resolved = new URL(`../lib/${name.slice(6)}.ts`, import.meta.url).href;
        else resolved = import.meta.resolve(name === 'next/link' ? 'next/link.js' : name);
        compiled = compiled.replaceAll(`'${name}'`, JSON.stringify(resolved)).replaceAll(`"${name}"`, JSON.stringify(resolved));
    }
    const url = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
    modules.set(path.href, url);
    return url;
}
async function component(path: string) { return import(await moduleUrl(new URL(`../components/${path}.tsx`, import.meta.url))); }

test('legacy homepage browsing preserves every filter, repeated campaign parameters and anchors', () => {
    const legacy = '/?category=property&q=office&emirate=Abu+Dhabi&type=Office&intent=rent&max=50000&sort=low&utm_source=ad&tag=a&tag=b#browse';
    const href = legacyMarketplaceHref(legacy)!;
    assert.equal(href, `/marketplace${legacy.slice(1)}`);
    const before = new URL(legacy, 'https://example.com');
    const after = new URL(href, 'https://example.com');
    assert.deepEqual(readMarketplaceFilters(after.searchParams), readMarketplaceFilters(before.searchParams));
    assert.deepEqual(after.searchParams.getAll('tag'), ['a', 'b']);
    assert.equal(after.hash, '#browse');
    assert.equal(legacyMarketplaceHref(href), null, 'no redirect loop');
});

test('legacy hash-only browsing is bridged while normal arrival, direct listings and auth paths are untouched', () => {
    assert.equal(legacyMarketplaceHref('/#browse'), '/marketplace#browse');
    assert.equal(legacyMarketplaceHref('/?utm_source=ad#emirate-browse-title'), '/marketplace?utm_source=ad#emirate-browse-title');
    for (const path of ['/', '/?utm_source=ad', '/#main', '/#location-browse-title', '/listing/office?emirate=Dubai', '/properties?intent=rent', '/vehicles', '/sell', '/signin?return_to=%2Fsell', '/account', '/api/nomod/webhook']) assert.equal(legacyMarketplaceHref(path), null, path);
});

test('all seven marketplace locations survive filters, category navigation, reset and history snapshots', () => {
    for (const emirate of EMIRATES) {
        const first = browseHref('/marketplace', '', emirate);
        const changed = marketplaceFilterHref(`${first}&utm_source=ad#browse`, { query: 'office', tab: 'property', intent: 'rent' });
        const allUae = marketplaceFilterHref(changed, { emirate: '' });
        assert.equal(new URL(allUae, 'https://example.com').searchParams.has('emirate'), false);
        assert.equal(readMarketplaceFilters(new URL(allUae, 'https://example.com').searchParams).intent, 'rent');
        assert.equal(readMarketplaceFilters(new URL(changed, 'https://example.com').searchParams).emirate, emirate);
        assert.equal(readMarketplaceFilters(new URL(first, 'https://example.com').searchParams).emirate, emirate);
        const reset = marketplaceFilterHref(changed, DEFAULT_MARKETPLACE_FILTERS);
        assert.equal(reset, '/marketplace?utm_source=ad#browse');
        assert.deepEqual(readMarketplaceFilters(new URL(reset, 'https://example.com').searchParams), DEFAULT_MARKETPLACE_FILTERS);
    }
});

test('category-first welcome includes all seven text-only locations, All UAE and the original 21 SEO links', async () => {
    const { Welcome } = await component('welcome');
    const html = renderToStaticMarkup(createElement(Welcome));
    assert.ok(html.includes('href="/marketplace"'));
    assert.ok(html.includes('Browse All UAE'));
    for (const emirate of EMIRATES) {
        assert.ok(html.includes(`href="${browseHref('/marketplace', '', emirate).replaceAll('&', '&amp;')}"`));
        for (const category of BROWSE_CATEGORIES) {
            const anchor = `href="${browseHref(category.path, category.intent, emirate).replaceAll('&', '&amp;')}"`;
            assert.equal(html.split(anchor).length - 1, 1, `${category.id}: ${emirate}`);
            assert.ok(html.includes(`${category.locationLabel} in ${emirate}`));
        }
    }
    assert.ok(!html.includes('/images/emirates/'), 'emirates have no photographs');
    assert.ok(html.indexOf('Browse by Category') < html.indexOf('Have a location in mind?'));
    assert.ok(html.indexOf('Shops &amp; businesses for sale') < html.indexOf('Have a location in mind?'));
    assert.ok(!html.includes('Start with your emirate'));
    for (const category of BROWSE_CATEGORIES) {
        assert.ok(html.includes(`href="${browseHref(category.path, category.intent).replaceAll('&', '&amp;')}"`));
    }
    for (const type of BUSINESS_TYPES) assert.ok(html.includes(`href="${marketplaceFilterHref('/properties', { type, intent: 'sale' }, 'property').replaceAll('&', '&amp;')}"`));
    assert.equal((html.match(/class="location-panel"[^>]*hidden/g) || []).length, 0);
});

test('all category photo shortcuts carry selected emirate, category and purpose', async () => {
    const { BrowseCategories } = await component('home-browsing');
    for (const emirate of ['', ...EMIRATES]) {
        const html = renderToStaticMarkup(createElement(BrowseCategories, { emirate }));
        assert.equal((html.match(/<a /g) || []).length, 3);
        for (const category of BROWSE_CATEGORIES) assert.ok(html.includes(`href="${browseHref(category.path, category.intent, emirate).replaceAll('&', '&amp;')}"`));
    }
});


test('welcome header preserves sign-in/account and posting destinations; marketplace header carries location', async () => {
    const { Header } = await component('marketplace');
    const navigation = await import(navigationUrl);
    navigation.setHref('/');
    let html = renderToStaticMarkup(createElement(Header, { viewer: null }));
    assert.ok(html.includes('class="welcome-header"'));
    assert.ok(html.includes('href="/sell"'));
    assert.ok(html.includes('href="/signin?return_to=%2Faccount"'));
    assert.ok(html.includes('Post Ad'));
    html = renderToStaticMarkup(createElement(Header, { viewer: { name: 'Test seller', email: 'seller@example.test', admin: false } }));
    assert.ok(html.includes('My account'));
    assert.ok(!html.includes('/signin?'));
    for (const emirate of EMIRATES) {
        navigation.setHref(browseHref('/marketplace', '', emirate));
        html = renderToStaticMarkup(createElement(Header, { viewer: null }));
        assert.ok(!html.includes('class="welcome-header"'));
        for (const path of ['/properties', '/vehicles']) assert.ok(html.includes(`href="${browseHref(path, '', emirate)}"`));
    }
});

test('marketplace SSR selects linked emirate in both search controls and category destinations', async () => {
    const { Home } = await component('marketplace');
    const navigation = await import(navigationUrl);
    for (const emirate of EMIRATES) {
        navigation.setHref(browseHref('/marketplace', '', emirate));
        const html = renderToStaticMarkup(createElement(Home, { listings: [], viewer: null }));
        assert.ok(html.includes(`<option selected="">${emirate}</option>`), emirate);
        assert.ok(html.includes('aria-label="Browse emirate"'));
        assert.ok(html.includes('Browse All UAE'));
        for (const category of BROWSE_CATEGORIES) assert.ok(html.includes(`href="${browseHref(category.path, category.intent, emirate).replaceAll('&', '&amp;')}"`));
        assert.ok(html.includes('Your next opportunity belongs here.'));
    }
});

test('sitemap adds the unfiltered marketplace without adding query URLs or removing listing URLs', async () => {
    const source = await readFile(new URL('../app/sitemap.xml/route.ts', import.meta.url), 'utf8');
    const mock = `data:text/javascript;base64,${Buffer.from(`export function database() { return {prepare() { return {async all() {return {results: [{slug:'test-fixture',updated_at:'2026-01-01'}]}}}}}}`).toString('base64')}`;
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
        .replaceAll("'@/lib/server'", JSON.stringify(mock))
        .replaceAll("'@/lib/catalog'", JSON.stringify(new URL('../lib/catalog.ts', import.meta.url).href));
    const { GET } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
    const response = await GET();
    const xml = await response.text();
    assert.equal(response.status, 200);
    for (const path of ['', '/marketplace', '/properties', '/vehicles', '/listing/test-fixture']) assert.ok(xml.includes(`<loc>https://www.poomasbuyandsell.com${path}</loc>`));
    assert.ok(!xml.includes('?emirate='));
});


test('destination cards and footer retain location; changing destination keeps other marketplace filters', async () => {
    const { EmirateCards } = await component('home-browsing');
    const { Footer, Header } = await component('marketplace');
    const navigation = await import(navigationUrl);
    const search = 'q=office&category=property&emirate=Dubai&intent=rent&utm_source=ad';
    const html = renderToStaticMarkup(createElement(EmirateCards, { search }));
    for (const emirate of EMIRATES) {
        const href = marketplaceFilterHref(`/marketplace?${search}`, { emirate });
        assert.ok(html.includes(`href="${href.replaceAll('&', '&amp;')}"`));
    }
    navigation.setHref('/marketplace?emirate=Sharjah');
    const footer = renderToStaticMarkup(createElement(Footer));
    for (const path of ['/properties', '/vehicles']) assert.ok(footer.includes(`href="${browseHref(path, '', 'Sharjah')}"`));
    navigation.setHref('/?emirate=Dubai#browse');
    assert.ok(!renderToStaticMarkup(createElement(Header, { viewer: null })).includes('class="welcome-header"'));
});

test('actual browse rendering preserves filtered results, empty results and direct listing destinations', async () => {
    const { Browse } = await component('marketplace');
    const navigation = await import(navigationUrl);
    // Isolated render fixtures only: never inserted into any database or public UI.
    const listing = { id: 'test-office', slug: 'test-office', category: 'property', subtype: 'Office', title: 'Test fitted office', description: 'Test parking', emirate: 'Dubai', area: 'Test area', price: 50000, intent: 'rent', images: ['/test-image.webp'], specs: {}, status: 'published' } as Listing;
    const listings = [listing, { ...listing, id: 'test-other', slug: 'test-other', title: 'Test other office', emirate: 'Sharjah' }];
    navigation.setHref('/marketplace?emirate=Dubai&category=property&intent=rent&q=parking&max=60000');
    let html = renderToStaticMarkup(createElement(Browse, { listings, viewer: null }));
    assert.ok(html.includes('href="/listing/test-office"'));
    assert.ok(!html.includes('href="/listing/test-other"'));
    navigation.setHref('/marketplace?emirate=Fujairah');
    html = renderToStaticMarkup(createElement(Browse, { listings, viewer: null }));
    assert.ok(html.includes('No listings match your search.'));
    assert.ok(!html.includes('class="listing-card"'));
    navigation.setHref('/marketplace?emirate=Dubai');
    html = renderToStaticMarkup(createElement(Browse, { listings, viewer: null, category: 'vehicle' }));
    assert.ok(html.includes('No listings match your search.'));
});

test('legacy vehicle rental URLs server-render supported sale results', async () => {
    const { Browse } = await component('marketplace');
    const navigation = await import(navigationUrl);
    const fixture = { id: 'qa-suv', slug: 'qa-suv', category: 'vehicle', subtype: 'SUV', title: 'QA vehicle for sale', description: 'QA', emirate: 'Dubai', area: 'QA', price: 100.50, intent: 'sale', images: ['/qa.webp'], specs: {}, status: 'published' } as Listing;
    for (const category of ['vehicle', undefined] as const) {
        navigation.setHref(category ? '/vehicles?intent=rent' : '/marketplace?category=vehicle&intent=rent');
        const html = renderToStaticMarkup(createElement(Browse, { listings: [fixture], viewer: null, category }));
        assert.ok(html.includes('href="/listing/qa-suv"'));
    }
});

test('listing cards and detail pricing preserve fractional AED amounts in real server rendering', async () => {
    const { Card, DetailActions, SellForm } = await component('marketplace');
    const fixture = { id: 'qa-suv', slug: 'qa-suv', category: 'vehicle', subtype: 'SUV', title: 'QA vehicle for sale', description: 'QA', emirate: 'Dubai', area: 'QA', price: 100.50, intent: 'sale', images: ['/qa.webp'], specs: {}, status: 'published', seller_name: 'QA' } as Listing;
    for (const Component of [Card, DetailActions]) {
        const html = renderToStaticMarkup(createElement(Component, { listing: fixture, viewer: null })).replaceAll('\u00a0', ' ');
        assert.ok(html.includes('AED 100.50'));
        assert.ok(!html.includes('AED 101'));
    }
    const form = renderToStaticMarkup(createElement(SellForm, { viewer: { name: 'QA', email: 'qa@example.test', admin: false } }));
    assert.ok(form.includes('step="0.01"'));
});


test('business shortcuts use supported commercial sale filters, preserve location and never invent a top-level category', async () => {
    const { BusinessCategories } = await component('home-browsing');
    for (const emirate of ['', ...EMIRATES]) {
        const search = new URLSearchParams({ emirate, intent: 'rent', type: 'Office', utm_source: 'test' }).toString();
        const html = renderToStaticMarkup(createElement(BusinessCategories, { search }));
        assert.equal((html.match(/<a /g) || []).length, 6);
        for (const type of BUSINESS_TYPES) {
            const href = marketplaceFilterHref(`/properties?${search}`, { type, intent: 'sale' }, 'property');
            assert.ok(html.includes(`href="${href.replaceAll('&', '&amp;')}"`));
            assert.deepEqual(readMarketplaceFilters(new URL(href, 'https://example.test').searchParams, 'property'), { ...DEFAULT_MARKETPLACE_FILTERS, tab: 'property', intent: 'sale', type, emirate });
            assert.ok(TYPES.property.includes(type));
            assert.ok(!TYPES.vehicle.includes(type));
        }
    }
});

test('business destinations render matching listings across UAE, isolated by exact type and purpose', async () => {
    const { Browse } = await component('marketplace');
    const navigation = await import(navigationUrl);
    const base = { category: 'property', title: 'Isolated business fixture', description: 'Isolated fixture', area: 'Test area', price: 100.50, intent: 'sale', images: ['/fixture.webp'], specs: {}, status: 'published' };
    for (const type of BUSINESS_TYPES) {
        const listings = [
            { ...base, id: 'test-dubai', slug: 'test-dubai', subtype: type, emirate: 'Dubai' },
            { ...base, id: 'test-sharjah', slug: 'test-sharjah', subtype: type, emirate: 'Sharjah' },
            { ...base, id: 'test-office', slug: 'test-office', subtype: 'Office', emirate: 'Dubai' },
            { ...base, id: 'test-rental', slug: 'test-rental', subtype: type, emirate: 'Dubai', intent: 'rent' },
        ] as Listing[];
        navigation.setHref(marketplaceFilterHref('/properties', { type, intent: 'sale' }, 'property'));
        let html = renderToStaticMarkup(createElement(Browse, { listings, viewer: null, category: 'property' }));
        assert.ok(html.includes('href="/listing/test-dubai"'));
        assert.ok(html.includes('href="/listing/test-sharjah"'));
        assert.ok(!html.includes('href="/listing/test-office"'));
        assert.ok(!html.includes('href="/listing/test-rental"'));
        assert.equal((html.match(/aria-current="page"/g) || []).length, 1, 'selected business type is visible');
        navigation.setHref(marketplaceFilterHref('/properties', { type, intent: 'sale', emirate: 'Fujairah' }, 'property'));
        html = renderToStaticMarkup(createElement(Browse, { listings, viewer: null, category: 'property' }));
        assert.ok(html.includes('No listings match your search.'));
    }
});

test('seller form exposes every approved business type through the existing type control', async () => {
    const { SellForm } = await component('marketplace');
    const viewer = { name: 'QA', email: 'qa@example.test', admin: false };
    const form = renderToStaticMarkup(createElement(SellForm, { viewer }));
    for (const type of BUSINESS_TYPES) assert.ok(form.includes(`<option>${type}</option>`));

});
