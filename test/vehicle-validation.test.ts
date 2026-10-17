import test from 'node:test';
import assert from 'node:assert/strict';
import { listingInput } from '../lib/validation.ts';
import { decodeListing, listingMoney, money } from '../lib/catalog.ts';
import { vehicleMaxYear, VEHICLE_MAX_MILEAGE, vehicleSpecIssues } from '../lib/vehicle.ts';

const valid = { title: 'QA vehicle validation fixture', category: 'vehicle', subtype: 'SUV', emirate: 'Dubai', area: 'Business Bay', price: 100.50, intent: 'sale', description: 'An isolated vehicle validation fixture, never submitted to production.', phone: '+971501234567', sellerName: 'QA Seller', images: ['/api/media/11111111-1111-4111-8111-111111111111'], specs: { Make: 'Toyota', Model: 'Land Cruiser', Year: '2021', Mileage: '165000' } };
const parseSpecs = (patch: Record<string, unknown>) => listingInput.safeParse({ ...valid, specs: { ...valid.specs, ...patch } });

test('supported vehicle fields accept normal make/model names and boundary values', () => {
    assert.ok(listingInput.safeParse(valid).success);
    for (const Make of ['Škoda', 'Mercedes-Benz', ' Land Rover ']) assert.ok(parseSpecs({ Make }).success);
    for (const Model of ['500', 'F-150', 'ATTO 3']) assert.ok(parseSpecs({ Model }).success);
    for (const Year of ['1900', String(vehicleMaxYear())]) assert.ok(parseSpecs({ Year }).success);
    for (const Mileage of ['0', '00012', String(VEHICLE_MAX_MILEAGE)]) assert.ok(parseSpecs({ Mileage }).success);
});

test('make and model are required, printable and bounded on the server', () => {
    for (const field of ['Make', 'Model']) for (const value of [undefined, '', '   ', 'Bad\u0000value', 'x'.repeat(field === 'Make' ? 61 : 91)]) {
        const result = parseSpecs({ [field]: value });
        assert.equal(result.success, false, `${field}: ${value}`);
        if (!result.success) assert.ok(result.error.issues.some(issue => issue.path.join('.') === `specs.${field}`));
    }
});

test('year rejects long years, fractions, non-decimal notation, units and out-of-range years', () => {
    for (const Year of ['999999', '275760', '02021', '1899', String(vehicleMaxYear() + 1), '2021.0', '2.021e3', '0x7e5', '20 21', 'NaN', 'Infinity', '-2021', '2021 AD']) assert.equal(parseSpecs({ Year }).success, false, Year);
    assert.equal(vehicleMaxYear(new Date('2026-12-31T23:59:59Z')), 2027);
    assert.equal(vehicleMaxYear(new Date('2027-01-01T00:00:00Z')), 2028);
});

test('mileage rejects negative, fractional, malformed and implausibly large values', () => {
    for (const Mileage of ['-1', '+1', '12.5', '1e3', '0x100', '165,000', '165000 km', 'NaN', 'Infinity', '1 000', String(VEHICLE_MAX_MILEAGE + 1), '9999999999999999999999']) assert.equal(parseSpecs({ Mileage }).success, false, Mileage);
    assert.equal(parseSpecs({ Mileage: 100 }).success, false, 'specs retain their string storage contract');
});

test('optional year and mileage remain optional; property specifications are unaffected', () => {
    assert.ok(listingInput.safeParse({ ...valid, specs: { Make: 'Toyota', Model: 'Land Cruiser' } }).success);
    assert.ok(parseSpecs({ Year: '', Mileage: '' }).success);
    assert.ok(listingInput.safeParse({ ...valid, category: 'property', subtype: 'Office', intent: 'rent', specs: { Area: '1000', Parking: '2 spaces' } }).success);
    assert.ok(!listingInput.safeParse({ ...valid, intent: 'rent' }).success);
});

test('form and server share field-specific vehicle checks', () => {
    const specs = { Make: ' ', Model: '', Year: '999999', Mileage: '-1' };
    const result = listingInput.safeParse({ ...valid, specs });
    assert.ok(!result.success);
    if (!result.success) for (const issue of vehicleSpecIssues(specs)) assert.ok(result.error.issues.some(error => error.path.join('.') === `specs.${issue.field}` && error.message === issue.message));
});

test('legacy records remain readable without automatic validation, rewriting or numeric coercion', () => {
    const specs = { Year: 'Unknown', Mileage: '165,000 km', Specification: 'GCC' };
    const row = { ...valid, specs: JSON.stringify(specs), images: JSON.stringify(valid.images) };
    const listing = decodeListing(row);
    assert.deepEqual(listing.specs, specs);
    assert.equal(listing.price, 100.50);
    assert.equal(row.specs, JSON.stringify(specs));
});

test('listing AED formatting consistently preserves fils while existing quote formatting is unchanged', () => {
    const normalized = (value: string) => value.replaceAll('\u00a0', ' ');
    for (const [price, expected] of [[100.5, 'AED 100.50'], [100, 'AED 100.00'], [0.01, 'AED 0.01'], [87000, 'AED 87,000.00'], [100.05, 'AED 100.05']] as const) assert.equal(normalized(listingMoney(price)), expected);
    assert.equal(normalized(money(100.5)), 'AED 101', 'existing promotion formatter remains unchanged');
    assert.equal(valid.price, 100.50, 'formatting never mutates listing amounts');
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the unchanged real market handlers and server guards against SQLite
// in memory. No HTTP, Cloudflare bindings, production data or provider requests.
async function marketFixture() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.exec(readFileSync(new URL('../drizzle/0000_optimal_carnage.sql', import.meta.url), 'utf8'));
    function prepare(sql: string, args: (string | number | null)[] = []) {
        return {
            bind(...values: (string | number | null)[]) { return prepare(sql, values); },
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
            async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        };
    }
    const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
        sqlite.exec('BEGIN');
        try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const uri = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const unique = crypto.randomUUID();
    const envUrl = uri(`export const env={}; export function setEnv(value){Object.assign(env,value)} // ${unique}`);
    const authUrl = uri(`let user=null; export async function getUser(){return user} export function setUser(value){user=value} // ${unique}`);
    const environment = await import(envUrl), auth = await import(authUrl);
    environment.setEnv({ DB: db, ADMIN_EMAILS: 'admin@example.test' });
    function compile(path: string, imports: Record<string, string>) {
        let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
        for (const [name, target] of Object.entries(imports)) code = code.replaceAll(`'${name}'`, JSON.stringify(target)).replaceAll(`"${name}"`, JSON.stringify(target));
        return uri(code);
    }
    const server = compile('../lib/server.ts', { 'cloudflare:workers': envUrl, '@/app/auth': authUrl });
    const market = await import(compile('../app/api/market/route.ts', { '@/lib/server': server, '@/lib/catalog': new URL('../lib/catalog.ts', import.meta.url).href, '@/lib/validation': new URL('../lib/validation.ts', import.meta.url).href }));
    const seller = { userId: 'qa-seller', email: 'seller@example.test', displayName: 'QA Seller' };
    const admin = { userId: 'qa-admin', email: 'admin@example.test', displayName: 'QA Admin' };
    sqlite.prepare('INSERT INTO media(id,owner_id,content_type,created_at) VALUES (?,?,?,?)').run(valid.images[0].split('/').pop()!, seller.userId, 'image/webp', '2026-01-01');
    async function post(input: unknown, user = seller) {
        auth.setUser(user);
        const response = await market.POST(new Request('http://qa.local/api/market', { method: 'POST', headers: { Origin: 'http://qa.local', 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
        return { status: response.status, data: await response.json() };
    }
    async function publicListings() {
        auth.setUser(null);
        const response = await market.GET(new Request('http://qa.local/api/market'));
        assert.equal(response.status, 200);
        return (await response.json()).listings;
    }
    return { sqlite, post, publicListings, admin };
}

test('actual create and edit handlers reject the same invalid vehicle fields without changing a listing', async () => {
    const f = await marketFixture();
    try {
        const created = await f.post({ action: 'listing', data: valid });
        assert.equal(created.status, 201);
        const id = created.data.id;
        const original = f.sqlite.prepare('SELECT * FROM listings WHERE id=?').get(id);
        for (const specs of [{ ...valid.specs, Make: '' }, { ...valid.specs, Model: ' ' }, { ...valid.specs, Year: '999999' }, { ...valid.specs, Mileage: '-1' }, { ...valid.specs, Mileage: '1e5' }]) {
            for (const editing of [false, true]) {
                const result = await f.post({ action: 'listing', ...(editing ? { id } : {}), data: { ...valid, specs } });
                assert.equal(result.status, 400);
                assert.match(result.data.error, /^Enter (a |mileage)/);
            }
            assert.deepEqual(f.sqlite.prepare('SELECT * FROM listings WHERE id=?').get(id), original);
            assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM listings').get()!.n, 1);
        }
        assert.equal((await f.post({ action: 'listing', id, data: { ...valid, specs: { ...valid.specs, Mileage: '166000' } } })).status, 201);
        assert.equal(f.sqlite.prepare('SELECT status FROM listings WHERE id=?').get(id)!.status, 'pending');
    } finally { f.sqlite.close(); }
});

test('existing legacy vehicle records remain public and unchanged until a valid edit is submitted', async () => {
    const f = await marketFixture();
    try {
        const created = await f.post({ action: 'listing', data: valid });
        const id = created.data.id;
        const legacy = JSON.stringify({ Year: 'Unknown', Mileage: '165,000 km', Specification: 'GCC' });
        f.sqlite.prepare("UPDATE listings SET specs=?,status='published' WHERE id=?").run(legacy, id);
        const listings = await f.publicListings();
        assert.equal(listings.length, 1);
        assert.deepEqual(listings[0].specs, JSON.parse(legacy));
        assert.equal(f.sqlite.prepare('SELECT specs FROM listings WHERE id=?').get(id)!.specs, legacy);
        assert.equal((await f.post({ action: 'listing', id, data: valid })).status, 201);
        assert.equal(f.sqlite.prepare('SELECT slug FROM listings WHERE id=?').get(id)!.slug, created.data.slug);
    } finally { f.sqlite.close(); }
});

test('submission, edit, rejection and approval preserve property rent and exact listing amounts', async () => {
    for (const data of [valid, { ...valid, category: 'property', subtype: 'Office', intent: 'rent', specs: { Area: '1000' } }]) {
        const f = await marketFixture();
        try {
            const created = await f.post({ action: 'listing', data });
            assert.equal(created.status, 201);
            const id = created.data.id;
            assert.equal((await f.publicListings()).length, 0);
            assert.equal((await f.post({ action: 'status', listingId: id, status: 'published' })).status, 400);
            assert.equal((await f.post({ action: 'status', listingId: id, status: 'rejected', reason: 'QA review' }, f.admin)).status, 200);
            assert.equal((await f.post({ action: 'listing', id, data })).status, 201);
            assert.equal(f.sqlite.prepare('SELECT status FROM listings WHERE id=?').get(id)!.status, 'pending');
            assert.equal((await f.post({ action: 'status', listingId: id, status: 'published' }, f.admin)).status, 200);
            const [listing] = await f.publicListings();
            assert.equal(listing.price, 100.50);
            assert.equal(listing.intent, data.intent);
            assert.equal(listing.category, data.category);
            assert.equal(listing.emirate, 'Dubai');
        } finally { f.sqlite.close(); }
    }
});
