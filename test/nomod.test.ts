import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import {
    createCheckout, receiveWebhook, reconcilePayment, processPending, paymentMinor,
    paymentConfigured, NOMOD_RELEASE_APPROVED, PAYMENT_ORIGIN, type NomodContext,
} from '../lib/nomod.ts';

const orderId = '11111111-1111-4111-8111-111111111111';
const linkId = '22222222-2222-4222-8222-222222222222';
const chargeId = '33333333-3333-4333-8333-333333333333';
const secretBytes = Buffer.from('mock-webhook-key-not-a-merchant-credential');
const secret = 'whsec_' + secretBytes.toString('base64');
const migration = readFileSync(new URL('../drizzle/0001_glossy_colleen_wing.sql', import.meta.url), 'utf8');

// Real SQLite SQL/constraints/transactions, with the D1 async API surface.
function sqliteD1(sqlite: DatabaseSync) {
    function prepare(sql: string, args: (string | number | null)[] = []) {
        return {
            sql, args,
            bind(...values: (string | number | null)[]) { return prepare(sql, values); },
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async all() { return { success: true, results: sqlite.prepare(sql).all(...args), meta: {} }; },
            async run() {
                const result = sqlite.prepare(sql).run(...args);
                return { success: true, results: [], meta: { changes: Number(result.changes) } };
            },
        };
    }
    return {
        prepare,
        async batch(statements: ReturnType<typeof prepare>[]) {
            sqlite.exec('BEGIN');
            try {
                const results = [];
                for (const s of statements) {
                    const r = sqlite.prepare(s.sql).run(...s.args);
                    results.push({ success: true, results: [], meta: { changes: Number(r.changes) } });
                }
                sqlite.exec('COMMIT');
                return results;
            } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        },
    } as unknown as D1Database;
}
function fixture(migrate = true) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.exec(readFileSync(new URL('../drizzle/0000_optimal_carnage.sql', import.meta.url), 'utf8'));
    sqlite.exec(`INSERT INTO listings (id,slug,owner_id,seller_name,seller_email,phone,title,category,subtype,emirate,area,price,intent,description,status,created_at,updated_at)
        VALUES ('listing','test','seller','Seller','mock@example.test','mock','Office','property','Office','Dubai','Business Bay',100,'sale','Mock listing','published','now','now');`);
    sqlite.prepare("INSERT INTO promotions (id,owner_id,listing_id,package_id,status,amount,currency,created_at) VALUES (?,'seller','listing','boost','quoted',100,'AED','now')").run(orderId);
    if (migrate) sqlite.exec(migration);
    const calls: { url: string; init?: RequestInit }[] = [];
    let note = `Poomas promotion ${orderId}`;
    let handler: (url: string, init?: RequestInit) => Promise<Response> = async (url, init) => {
        if (init?.method === 'POST') {
            note = JSON.parse(String(init.body)).note;
            return Response.json(link(note), { status: 201 });
        }
        if (url.includes('/charges?')) {
            const u = new URL(url);
            assert.equal(u.searchParams.get('id'), chargeId);
            assert.equal(u.searchParams.get('link_id'), linkId);
            return Response.json({ count: 1, next: null, results: [charge(note)] });
        }
        if (url.endsWith('/links/' + linkId)) return Response.json(link(note));
        throw new Error('Unexpected mocked provider request');
    };
    const c: NomodContext = {
        db: sqliteD1(sqlite), enabled: true, apiKey: 'mock-api-key-not-a-credential', webhookSecret: secret, returnOrigin: PAYMENT_ORIGIN,
        request: (async (input, init) => {
            const url = String(input);
            assert.equal(new URL(url).origin, 'https://api.nomod.com');
            calls.push({ url, init });
            return handler(url, init);
        }) as typeof fetch,
    };
    return {
        sqlite, c, calls,
        handler(fn: typeof handler) { handler = fn; },
        note() { return note; },
        setNote(value: string) { note = value; },
        order() { return sqlite.prepare('SELECT * FROM promotions WHERE id=?').get(orderId)!; },
        event(id: string) { return sqlite.prepare('SELECT * FROM nomod_events WHERE id=?').get(id)!; },
        linked(status = 'awaiting_payment') { sqlite.prepare('UPDATE promotions SET status=?,nomod_id=?,payment_url=? WHERE id=?').run(status, linkId, link(note).url as string, orderId); },
    };
}
function link(note: string, patch = {}) {
    return { id: linkId, reference_id: 'L-MOCK', url: 'https://pay.nomodapp.com/en/l/mock', note, amount: '100.00', currency: 'AED', status: 'enabled', payment_block_reason: null, ...patch };
}
function charge(note: string, patch = {}) {
    return { id: chargeId, reference_id: 42, note, total: '100.00', currency: 'AED', status: 'paid', ...patch };
}
function event(note: string, type = 'charge.completed', patch = {}, id = randomUUID()) {
    return { eventId: id, objectId: 'ch_' + chargeId.replaceAll('-', ''), type, data: {
        id: chargeId, referenceId: 42, note, originalTotal: '100.000', originalCurrency: 'AED', status: 'paid', created: new Date().toISOString(), ...patch,
    } };
}
function signed(value: unknown, options: { tamper?: boolean; offset?: number; signature?: string } = {}) {
    const raw = JSON.stringify(value), timestamp = String(Math.floor(Date.now() / 1000) + (options.offset || 0)), id = 'msg_mock';
    const signature = 'v1,' + createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest('base64');
    return new Request(PAYMENT_ORIGIN + '/api/nomod/webhook', { method: 'POST', headers: {
        'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': options.signature ?? signature,
    }, body: raw + (options.tamper ? ' ' : '') });
}

test('additive migration preserves all legacy tables and records', () => {
    const f = fixture(false), before = f.order();
    f.sqlite.prepare('INSERT INTO webhook_events VALUES (?,?)').run('legacy-event', 'legacy-time');
    f.sqlite.exec(migration);
    assert.deepEqual(f.order(), before);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM webhook_events').get()!.n, 1);
    assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.doesNotMatch(migration.replaceAll(/ON UPDATE no action ON DELETE no action/gi, ''), /\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
});
test('release remains disabled irrespective of configured credentials', async () => {
    assert.equal(NOMOD_RELEASE_APPROVED, false);
    const f = fixture(); f.c.enabled = NOMOD_RELEASE_APPROVED;
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /disabled/);
    await assert.rejects(reconcilePayment(f.c, orderId, linkId, 'admin'), /disabled/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.order().status, 'quoted');
});
test('configuration requires activation, key, signing secret and exact approved HTTPS origin', async () => {
    for (const patch of [ { enabled: false }, { apiKey: '' }, { webhookSecret: '' }, { webhookSecret: 'malformed' },
        { returnOrigin: 'http://www.poomasbuyandsell.com' }, { returnOrigin: PAYMENT_ORIGIN + '/' }, { returnOrigin: 'https://evil.example' } ]) {
        const f = fixture(); Object.assign(f.c, patch);
        assert.equal(paymentConfigured(f.c), false);
        await assert.rejects(createCheckout(f.c, orderId, 'seller'));
        assert.equal(f.calls.length, 0);
    }
});
test('missing migration fails closed before provider request', async () => {
    const f = fixture(false);
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /migration/);
    await assert.rejects(receiveWebhook(f.c, signed(event(f.note()))), /migration/);
    assert.equal(f.calls.length, 0);
});
test('money matching rejects rounding, exponent, NaN, negative and nonzero mills', () => {
    assert.equal(paymentMinor('100.000'), 10000);
    assert.equal(paymentMinor('100.010'), 10001);
    for (const n of ['100.001', '1e2', 'NaN', '-100', ' 100', '', null]) assert.equal(paymentMinor(n), null);
});
test('checkout gates seller ownership, published listing and approved quotation', async () => {
    const other = fixture(); await assert.rejects(createCheckout(other.c, orderId, 'other'), /quotation/); assert.equal(other.calls.length, 0);
    for (const status of ['requested', 'creating_payment', 'paid', 'refunded']) {
        const f = fixture(); f.sqlite.prepare('UPDATE promotions SET status=?').run(status);
        await assert.rejects(createCheckout(f.c, orderId, 'seller')); assert.equal(f.calls.length, 0);
    }
    const unpublished = fixture(); unpublished.sqlite.exec("UPDATE listings SET status='pending'");
    await assert.rejects(createCheckout(unpublished.c, orderId, 'seller'), /listing/); assert.equal(unpublished.calls.length, 0);
});
test('checkout stores exactly one server-priced link and an audit reservation', async () => {
    const f = fixture();
    assert.equal(await createCheckout(f.c, orderId, 'seller'), link(f.note()).url);
    const body = JSON.parse(String(f.calls[0].init!.body));
    assert.equal(body.items[0].amount, '100.00');
    assert.equal(body.payment_expiry_limit, 1);
    assert.equal(body.allow_tip, false); assert.equal(body.allow_service_fee, false);
    assert.match(body.note, /^Poomas promotion .+ attempt .+$/);
    assert.equal(f.order().status, 'awaiting_payment'); assert.equal(f.order().nomod_id, linkId);
    await createCheckout(f.c, orderId, 'seller');
    assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM nomod_audit').get()!.n, 2);
});
test('concurrent checkout reserves only one outbound creation', async () => {
    const f = fixture();
    const results = await Promise.allSettled([createCheckout(f.c, orderId, 'seller'), createCheckout(f.c, orderId, 'seller')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 1);
});
test('quote or listing changed before reservation cannot create an outdated payment link', async () => {
    for (const sql of ["UPDATE promotions SET amount=120", "UPDATE listings SET status='pending'"]) {
        const f = fixture(), batch = f.c.db.batch.bind(f.c.db);
        f.c.db.batch = async statements => { f.sqlite.exec(sql); return batch(statements); };
        await assert.rejects(createCheckout(f.c, orderId, 'seller'), /already being prepared/);
        assert.equal(f.calls.length, 0); assert.equal(f.order().status, 'quoted');
        assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM nomod_attempts').get()!.n, 0);
    }
});
test('timeout and all non-OK responses retain creation lock and prohibit retry', async () => {
    for (const status of [0, 400, 401, 429, 500, 503]) {
        const f = fixture(); f.handler(async () => { if (!status) throw new Error('mock timeout'); return new Response('{}', { status }); });
        await assert.rejects(createCheckout(f.c, orderId, 'seller'));
        assert.equal(f.order().status, 'creating_payment');
        assert.equal(f.sqlite.prepare('SELECT state FROM nomod_attempts').get()!.state, 'ambiguous');
        await assert.rejects(createCheckout(f.c, orderId, 'seller'));
        assert.equal(f.calls.length, 1);
    }
});
test('invalid, blocked and disabled link responses hold reservation', async () => {
    for (const patch of [ { id: 'invented' }, { amount: '99.00' }, { currency: 'USD' }, { note: 'wrong' },
        { reference_id: '' }, { status: 'disabled' }, { status: { name: 'enabled' } }, { payment_block_reason: 'currency_unavailable' },
        { url: 'https://nomod.com.evil.example/pay' }, { url: 'http://pay.nomod.com/pay' }, { url: 'https://user:password@nomod.com/pay' } ]) {
        const f = fixture(); f.handler(async (_url, init) => Response.json(link(JSON.parse(String(init!.body)).note, patch), { status: 201 }));
        await assert.rejects(createCheckout(f.c, orderId, 'seller'));
        assert.equal(f.order().status, 'creating_payment'); assert.equal(f.order().nomod_id, null);
    }
    const f = fixture(); f.handler(async () => new Response('not-json', { status: 201 }));
    await assert.rejects(createCheckout(f.c, orderId, 'seller')); assert.equal(f.order().status, 'creating_payment');
});
test('early completion is durable and applied after link storage', async () => {
    const f = fixture(); let e: ReturnType<typeof event>;
    f.handler(async (url, init) => {
        if (init?.method === 'POST') {
            const note = JSON.parse(String(init.body)).note; f.setNote(note); e = event(note);
            await receiveWebhook(f.c, signed(e));
            assert.equal(f.event(e.eventId).outcome, 'pending_link');
            return Response.json(link(note), { status: 201 });
        }
        assert.ok(url.includes('link_id=' + linkId));
        return Response.json({ count: 1, next: null, results: [charge(f.note())] });
    });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /already been resolved/);
    assert.equal(f.order().status, 'paid'); assert.equal(f.event(e!.eventId).outcome, 'applied');
});
test('administrator recovery adopts original link after timeout without a second POST', async () => {
    const f = fixture(); f.handler(async (_url, init) => { f.setNote(JSON.parse(String(init!.body)).note); throw new Error('mock timeout'); });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'));
    const e = event(f.note()); await receiveWebhook(f.c, signed(e));
    f.handler(async url => Response.json(url.includes('/charges?') ? { count: 1, next: null, results: [charge(f.note())] } : link(f.note())));
    await reconcilePayment(f.c, orderId, linkId, 'admin');
    assert.equal(f.order().status, 'paid'); assert.equal(f.event(e.eventId).outcome, 'applied');
    assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 1);
    assert.equal(f.sqlite.prepare("SELECT actor_id FROM nomod_audit WHERE type='reconciliation' LIMIT 1").get()!.actor_id, 'admin');
});
test('recovery rejects a different attempt note and never releases reservation', async () => {
    const f = fixture(); f.handler(async () => { throw new Error('timeout'); });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'));
    f.handler(async () => Response.json(link('Poomas promotion ' + orderId)));
    await assert.rejects(reconcilePayment(f.c, orderId, linkId, 'admin'));
    assert.equal(f.order().status, 'creating_payment'); assert.equal(f.order().nomod_id, null);
    assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 1);
});
test('duplicate signed completion changes state once and retains one provider event', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    await receiveWebhook(f.c, signed(e)); await receiveWebhook(f.c, signed(e));
    assert.equal(f.order().status, 'paid'); assert.equal(f.event(e.eventId).outcome, 'applied');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM nomod_events').get()!.n, 1);
    assert.equal(f.calls.length, 1);
});
test('tampered, stale, missing and malformed signatures cannot write events', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    for (const options of [{ tamper: true }, { offset: -301 }, { offset: 301 }, { signature: '' }]) await assert.rejects(receiveWebhook(f.c, signed(e, options)), /signature/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM nomod_events').get()!.n, 0);
    assert.equal(f.calls.length, 0);
});
test('signed event-ID collision is rejected without overwriting original evidence', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    await receiveWebhook(f.c, signed(e));
    await assert.rejects(receiveWebhook(f.c, signed({ ...e, data: { ...e.data, originalTotal: '2.00' } })), /Conflicting/);
    assert.equal(f.event(e.eventId).amount, '100.000');
});
test('legacy processed event is not applied again', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    f.sqlite.prepare('INSERT INTO webhook_events VALUES (?,?)').run(e.eventId, 'legacy');
    await receiveWebhook(f.c, signed(e));
    assert.equal(f.event(e.eventId).outcome, 'legacy_duplicate'); assert.equal(f.order().status, 'awaiting_payment'); assert.equal(f.calls.length, 0);
});
test('unrelated link/charge, amount, currency, reference or note are rejected', async () => {
    for (const patch of [{ originalTotal: '99.00' }, { originalCurrency: 'USD' }, { note: `Poomas promotion ${orderId} attempt ${randomUUID()}` }, { status: 'authorised' }]) {
        const f = fixture(); f.linked(); const e = event(f.note(), 'charge.completed', patch);
        await receiveWebhook(f.c, signed(e)); assert.equal(f.order().status, 'awaiting_payment'); assert.match(String(f.event(e.eventId).outcome), /^rejected/);
    }
    for (const patch of [ { id: randomUUID() }, { total: '2.00' }, { currency: 'USD' }, { note: 'other' }, { reference_id: 43 }, { status: 'authorised' } ]) {
        const f = fixture(); f.linked(); f.handler(async () => Response.json({ count: 1, next: null, results: [charge(f.note(), patch)] }));
        const e = event(f.note()); await receiveWebhook(f.c, signed(e));
        assert.equal(f.order().status, 'awaiting_payment'); assert.equal(f.event(e.eventId).outcome, 'rejected_provider_match');
    }
    const f = fixture(); f.linked(); f.handler(async () => Response.json({ count: 0, next: null, results: [] }));
    await receiveWebhook(f.c, signed(event(f.note()))); assert.equal(f.order().status, 'awaiting_payment');
});
test('refund and dispute require matching signed and provider financial data', async () => {
    for (const type of ['charge.refunded', 'charge.partially_refunded', 'charge.dispute.created']) {
        const f = fixture(); f.linked('paid'); const bad = event(f.note(), type, { originalTotal: '2.00', originalCurrency: 'USD' });
        await receiveWebhook(f.c, signed(bad)); assert.equal(f.order().status, 'paid');
        f.handler(async () => Response.json({ count: 0, next: null, results: [] }));
        await receiveWebhook(f.c, signed(event(f.note(), type))); assert.equal(f.order().status, 'paid');
    }
});
test('refunds and disputes are monotonic under delayed completion and partial refunds', async () => {
    for (const [type, expected] of [['charge.refunded', 'refunded'], ['charge.partially_refunded', 'partially_refunded'], ['charge.dispute.created', 'disputed']]) {
        const f = fixture(); f.linked('paid');
        await receiveWebhook(f.c, signed(event(f.note(), type))); assert.equal(f.order().status, expected);
        await receiveWebhook(f.c, signed(event(f.note()))); assert.equal(f.order().status, expected);
        if (expected !== 'partially_refunded') {
            await receiveWebhook(f.c, signed(event(f.note(), 'charge.partially_refunded'))); assert.equal(f.order().status, expected);
        }
    }
});
test('a different charge cannot refund a promotion bound to a settled charge', async () => {
    const f = fixture(); f.linked(); await receiveWebhook(f.c, signed(event(f.note())));
    const otherCharge = randomUUID();
    f.handler(async () => Response.json({ count: 1, next: null, results: [charge(f.note(), { id: otherCharge })] }));
    const e = event(f.note(), 'charge.refunded', { id: otherCharge });
    await receiveWebhook(f.c, signed(e));
    assert.equal(f.order().status, 'paid'); assert.equal(f.event(e.eventId).outcome, 'rejected_charge_conflict');
});
test('failed/cancelled authorisations are audited and preserve original link retry', async () => {
    const f = fixture(); f.linked();
    for (const type of ['charge.failed', 'charge.cancelled']) {
        const e = event(f.note(), type, { status: type.slice(7) });
        await receiveWebhook(f.c, signed(e));
        assert.equal(f.event(e.eventId).outcome, type.replace('charge.', 'attempt_'));
        assert.equal(f.order().status, 'awaiting_payment'); assert.equal(f.order().nomod_id, linkId);
    }
    await createCheckout(f.c, orderId, 'seller'); assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 0);
    await receiveWebhook(f.c, signed(event(f.note()))); assert.equal(f.order().status, 'paid');
});
test('provider outage keeps durable event pending for authenticated reconciliation', async () => {
    const f = fixture(); f.linked(); const e = event(f.note()); f.handler(async () => { throw new Error('outage'); });
    await receiveWebhook(f.c, signed(e)); assert.equal(f.event(e.eventId).outcome, 'pending_provider'); assert.equal(f.order().status, 'awaiting_payment');
    f.handler(async () => Response.json({ count: 1, next: null, results: [charge(f.note())] }));
    await reconcilePayment(f.c, orderId, undefined, 'admin'); assert.equal(f.event(e.eventId).outcome, 'applied'); assert.equal(f.order().status, 'paid');
});
test('disabled release journals signed events without provider calls or promotion updates', async () => {
    const f = fixture(); f.linked(); f.c.enabled = false; const before = f.order(), e = event(f.note());
    await receiveWebhook(f.c, signed(e));
    assert.deepEqual(f.order(), before); assert.equal(f.event(e.eventId).outcome, 'pending_activation'); assert.equal(f.calls.length, 0);
});
test('audit storage excludes customer and sensitive card data from provider payloads', async () => {
    const f = fixture(); f.linked(); const e = event(f.note(), 'charge.completed', {
        customer: { email: 'sensitive@example.test' }, source: { card_data: { card_number: 'mock-sensitive-card', security_code: 'mock-cvv' } },
    });
    await receiveWebhook(f.c, signed(e));
    const stored = JSON.stringify(f.sqlite.prepare('SELECT * FROM nomod_events').all());
    assert.doesNotMatch(stored, /sensitive|card_number|security_code|customer/);
    assert.equal(f.event(e.eventId).charge_id, chargeId); assert.equal(f.event(e.eventId).link_id, linkId);
    assert.ok(f.event(e.eventId).received_at); assert.ok(f.event(e.eventId).processed_at);
});
test('unsupported/non-Poomas events are audited without provider calls', async () => {
    const f = fixture(); const e = event('another business payment', 'charge.created');
    await receiveWebhook(f.c, signed(e)); assert.equal(f.event(e.eventId).outcome, 'ignored'); assert.equal(f.calls.length, 0);
});
test('race between completion and refund retains pending state for replay', async () => {
    const f = fixture(); f.linked(); let interleaved = false;
    f.handler(async () => {
        if (!interleaved) {
            interleaved = true;
            await receiveWebhook(f.c, signed(event(f.note(), 'charge.completed')));
        }
        return Response.json({ count: 1, next: null, results: [charge(f.note())] });
    });
    const refund = event(f.note(), 'charge.refunded'); await receiveWebhook(f.c, signed(refund));
    assert.equal(f.order().status, 'paid'); assert.equal(f.event(refund.eventId).outcome, 'pending_provider');
    await processPending(f.c, orderId); assert.equal(f.order().status, 'refunded'); assert.equal(f.event(refund.eventId).outcome, 'applied');
});

// Exercise the actual route/server guards, while replacing only Cloudflare's
// bindings and the identity provider. No actual authentication code is changed.
const routeState = { env: {} as Record<string, unknown>, user: null as null | { userId: string; email: string } };
(globalThis as unknown as Record<string, unknown>).__poomasNomodTests = routeState;
function moduleUrl(source: string) { return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); }
function compiled(path: string, replacements: Record<string, string>) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const js = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
    return moduleUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, name: string) => 'from ' + JSON.stringify(replacements[name] || name)));
}
const serverUrl = compiled('lib/server.ts', {
    'cloudflare:workers': moduleUrl('export const env=globalThis.__poomasNomodTests.env'),
    '@/app/auth': moduleUrl('export async function getUser(){return globalThis.__poomasNomodTests.user}'),
});
const nomodUrl = pathToFileURL(new URL('../lib/nomod.ts', import.meta.url).pathname).href;
const contextUrl = compiled('lib/nomod-server.ts', { '@/lib/server': serverUrl, './nomod.ts': nomodUrl });
async function route(path: string) {
    return import(compiled(path, { '@/lib/server': serverUrl, '@/lib/nomod': nomodUrl, '@/lib/nomod-server': contextUrl }));
}
function apiRequest(path: string, body = { id: orderId }, origin = PAYMENT_ORIGIN) {
    return new Request(PAYMENT_ORIGIN + path, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
test('actual checkout/reconciliation routes enforce identity, origin, admin and immutable activation lock', async () => {
    const f = fixture(); Object.assign(routeState.env, { DB: f.c.db, NOMOD_API_KEY: f.c.apiKey, NOMOD_WEBHOOK_SECRET: secret, PAYMENT_RETURN_ORIGIN: PAYMENT_ORIGIN, NOMOD_PAYMENTS_ENABLED: 'true', ADMIN_EMAILS: 'admin@example.test' });
    const checkout = await route('app/api/checkout/route.ts'), reconcile = await route('app/api/nomod/reconcile/route.ts');
    assert.deepEqual(await (await checkout.GET()).json(), { paymentsEnabled: false });
    routeState.user = null;
    assert.equal((await checkout.POST(apiRequest('/api/checkout'))).status, 401);
    assert.equal((await reconcile.POST(apiRequest('/api/nomod/reconcile'))).status, 401);
    routeState.user = { userId: 'seller', email: 'seller@example.test' };
    assert.equal((await checkout.POST(apiRequest('/api/checkout', { id: orderId }, 'https://evil.example'))).status, 403);
    assert.equal((await reconcile.POST(apiRequest('/api/nomod/reconcile'))).status, 403);
    assert.equal((await checkout.POST(apiRequest('/api/checkout'))).status, 503);
    routeState.user = { userId: 'admin', email: 'admin@example.test' };
    assert.equal((await reconcile.POST(apiRequest('/api/nomod/reconcile'))).status, 503);
    assert.equal(f.calls.length, 0); assert.equal(f.order().status, 'quoted');
});
test('actual webhook route durably journals while release-locked and never calls the provider', async () => {
    const f = fixture(); f.linked();
    Object.assign(routeState.env, { DB: f.c.db, NOMOD_API_KEY: f.c.apiKey, NOMOD_WEBHOOK_SECRET: secret, PAYMENT_RETURN_ORIGIN: PAYMENT_ORIGIN, NOMOD_PAYMENTS_ENABLED: 'true' });
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; throw new Error('No real network permitted'); };
    try {
        const webhook = await route('app/api/nomod/webhook/route.ts'), e = event(f.note());
        assert.equal((await webhook.POST(signed(e))).status, 200);
        assert.equal(f.event(e.eventId).outcome, 'pending_activation');
        assert.equal(f.order().status, 'awaiting_payment'); assert.equal(fetches, 0);
    } finally { globalThis.fetch = originalFetch; }
});
