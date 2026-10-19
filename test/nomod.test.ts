import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sellerPaymentStatus } from '../lib/payment-status.ts';
import { paymentStatusCopy, paymentMoney, safeCheckoutDestination } from '../lib/payment-display.ts';
import { approvePromotionQuote } from '../lib/promotion-quote.ts';
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import {
    createCheckout, receiveWebhook, reconcilePayment, processPending, paymentMinor,
    paymentConfigured, NOMOD_RELEASE_APPROVED, PAYMENT_ORIGIN, recoveryOverview, VERIFICATION_LIMIT, VERIFICATION_COOLDOWN_MS, REPLAY_BATCH_SIZE, type NomodContext,
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
    assert.equal(body.success_url, `${PAYMENT_ORIGIN}/account?payment=returned&promotion=${orderId}`);
    assert.equal(body.failure_url, `${PAYMENT_ORIGIN}/account?payment=failed&promotion=${orderId}`);
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
    const calls = f.calls.length;
    await reconcilePayment(f.c, orderId, undefined, 'admin'); assert.equal(f.calls.length, calls); // Cooldown is enforced.
    f.sqlite.exec("UPDATE nomod_audit SET created_at='2000-01-01T00:00:00.000Z' WHERE type='provider_verification'");
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
    f.sqlite.exec("UPDATE nomod_audit SET created_at='2000-01-01T00:00:00.000Z' WHERE type='provider_verification'");
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
    return import(compiled(path, { '@/lib/server': serverUrl, '@/lib/promotion-quote': new URL('../lib/promotion-quote.ts', import.meta.url).href, '@/lib/catalog': new URL('../lib/catalog.ts', import.meta.url).href, '@/lib/validation': new URL('../lib/validation.ts', import.meta.url).href, '@/lib/nomod': nomodUrl, '@/lib/nomod-server': contextUrl, '@/lib/payment-status': new URL('../lib/payment-status.ts', import.meta.url).href }));
}
function apiRequest(path: string, body: unknown = { id: orderId }, origin = PAYMENT_ORIGIN) {
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

test('seller payment status is ownership-scoped, read-only and never trusts return hints', async () => {
    const f = fixture();
    assert.equal(await sellerPaymentStatus(f.c.db, orderId, 'other-seller'), null);
    assert.equal(await sellerPaymentStatus(f.c.db, 'bad-id', 'seller'), null);
    const initial = await sellerPaymentStatus(f.c.db, orderId, 'seller');
    assert.equal(initial?.status, 'quoted'); assert.equal(initial?.verified, false);
    assert.deepEqual(Object.keys(initial!).sort(), ['amount', 'currency', 'id', 'lastAttempt', 'packageId', 'status', 'title', 'verified'].sort());
    f.linked(); await receiveWebhook(f.c, signed(event(f.note())));
    const paid = await sellerPaymentStatus(f.c.db, orderId, 'seller');
    assert.equal(paid?.status, 'paid'); assert.equal(paid?.verified, true);
    assert.equal(f.calls.filter(x => x.init?.method === 'POST').length, 0);
});
test('seller status distinguishes verified failed/cancelled attempts from paid fulfillment', async () => {
    const f = fixture(); f.linked();
    await receiveWebhook(f.c, signed(event(f.note(), 'charge.failed', { status: 'failed' })));
    const failed = await sellerPaymentStatus(f.c.db, orderId, 'seller');
    assert.equal(failed?.lastAttempt, 'attempt_failed'); assert.equal(failed?.verified, false);
    assert.equal(paymentStatusCopy(failed!.status, false, failed!.lastAttempt).title, 'Payment attempt failed');
    await receiveWebhook(f.c, signed(event(f.note())));
    assert.equal(paymentStatusCopy('paid', true, 'attempt_failed').title, 'Payment verified');
    assert.match(paymentStatusCopy('paid', true).message, /delivery and scheduling.*separately/);
    assert.equal(paymentStatusCopy('paid', false).title, 'Payment needs review');
    for (const status of ['refunded', 'disputed', 'partially_refunded']) assert.equal(paymentStatusCopy(status, true).pending, false);
});
test('provider retry budget persists across contexts and repeated deliveries cannot bypass cooldown', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    f.handler(async () => { throw new Error('outage'); });
    await receiveWebhook(f.c, signed(e));
    const calls = f.calls.length;
    await Promise.all([receiveWebhook(f.c, signed(e)), processPending(f.c, orderId)]);
    assert.equal(f.calls.length, calls);
    for (let i = 1; i < VERIFICATION_LIMIT; i++) {
        f.sqlite.exec("UPDATE nomod_audit SET created_at='2000-01-01T00:00:00.000Z' WHERE type='provider_verification'");
        await processPending({ ...f.c }, orderId);
    }
    f.sqlite.exec("UPDATE nomod_audit SET created_at='2000-01-01T00:00:00.000Z' WHERE type='provider_verification'");
    await receiveWebhook(f.c, signed(e)); await reconcilePayment(f.c, orderId, undefined, 'admin');
    assert.equal(f.calls.length, VERIFICATION_LIMIT);
    assert.equal(f.event(e.eventId).outcome, 'pending_provider'); assert.equal(f.order().status, 'awaiting_payment');
    const overview = await recoveryOverview(f.c);
    assert.equal(overview.events[0].attempts, VERIFICATION_LIMIT);
    assert.equal(overview.events[0].id, e.eventId);
});
test('concurrent pending replays reserve one provider verification and one settlement', async () => {
    const f = fixture(); f.linked(); f.c.enabled = false;
    const e = event(f.note()); await receiveWebhook(f.c, signed(e)); f.c.enabled = true;
    await Promise.all([processPending(f.c, orderId), processPending(f.c, orderId)]);
    assert.equal(f.calls.length, 1); assert.equal(f.order().status, 'paid');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM nomod_payments').get()!.n, 1);
});
test('replay batch is bounded and cooling-down events do not starve eligible events', async () => {
    const f = fixture(); f.linked(); f.c.enabled = false;
    for (let i = 0; i < REPLAY_BATCH_SIZE + 2; i++) await receiveWebhook(f.c, signed(event(f.note(), 'charge.failed', { status: 'failed' })));
    f.c.enabled = true; f.handler(async () => { throw new Error('outage'); });
    await processPending(f.c, orderId); assert.equal(f.calls.length, REPLAY_BATCH_SIZE);
    await processPending(f.c, orderId); assert.equal(f.calls.length, REPLAY_BATCH_SIZE + 2);
    assert.equal(f.order().status, 'awaiting_payment');
});
test('disabled recovery inspection does not spend retry budget, call provider or alter orders', async () => {
    const f = fixture(); await createCheckout(f.c, orderId, 'seller'); f.c.enabled = false;
    const e = event(f.note()); await receiveWebhook(f.c, signed(e)); const before = f.order(), calls = f.calls.length;
    await processPending(f.c, orderId);
    const overview = await recoveryOverview(f.c);
    assert.equal(overview.enabled, false); assert.equal(overview.events[0].attempts, 0);
    assert.equal(overview.events[0].outcome, 'pending_activation');
    assert.deepEqual(f.order(), before); assert.equal(f.calls.length, calls);
    assert.doesNotMatch(JSON.stringify(overview), /apiKey|webhookSecret|payment_url|customer|card_number/);
});
test('recovery overview exposes ambiguous attempts and paginates without losing rows', async () => {
    const f = fixture(); f.handler(async () => { throw new Error('timeout'); });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'));
    const overview = await recoveryOverview(f.c);
    assert.equal(overview.attempts[0].order_id, orderId); assert.equal(overview.attempts[0].state, 'ambiguous');
    for (let i = 0; i < 52; i++) await receiveWebhook(f.c, signed(event(f.note())));
    const first = await recoveryOverview(f.c), second = await recoveryOverview(f.c, 1);
    assert.equal(first.events.length, 50); assert.equal(first.hasMore, true);
    assert.equal(second.events.length, 2); assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.events, ...second.events].map(x => x.id)).size, 52);
});
test('read-only recovery GET enforces admin identity even while release-locked', async () => {
    const f = fixture(); f.linked(); f.c.enabled = false;
    await receiveWebhook(f.c, signed(event(f.note())));
    Object.assign(routeState.env, { DB: f.c.db, ADMIN_EMAILS: 'admin@example.test' });
    const reconcile = await route('app/api/nomod/reconcile/route.ts');
    const request = new Request(PAYMENT_ORIGIN + '/api/nomod/reconcile');
    routeState.user = null; assert.equal((await reconcile.GET(request)).status, 401);
    routeState.user = { userId: 'seller', email: 'seller@example.test' }; assert.equal((await reconcile.GET(request)).status, 403);
    routeState.user = { userId: 'admin', email: 'admin@example.test' };
    const response = await reconcile.GET(request); assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const data = await response.json(); assert.equal(data.enabled, false); assert.equal(data.events.length, 1);
    assert.equal((await reconcile.GET(new Request(PAYMENT_ORIGIN + '/api/nomod/reconcile?page=-1'))).status, 400);
    assert.equal(f.calls.length, 0);
});
test('actual seller status endpoint rejects unauthenticated and cross-account access', async () => {
    const f = fixture(); Object.assign(routeState.env, { DB: f.c.db });
    const status = await route('app/api/promotions/payment-status/route.ts');
    const request = new Request(PAYMENT_ORIGIN + '/api/promotions/payment-status?id=' + orderId + '&payment=success');
    routeState.user = null; assert.equal((await status.GET(request)).status, 401);
    routeState.user = { userId: 'other', email: 'other@example.test' }; assert.equal((await status.GET(request)).status, 404);
    routeState.user = { userId: 'seller', email: 'seller@example.test' };
    const response = await status.GET(request); assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'quoted'); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(f.calls.length, 0); assert.equal(f.order().status, 'quoted');
});
test('early-event backlog beyond one batch remains replayable after the link is stored', async () => {
    const f = fixture();
    for (let i = 0; i < REPLAY_BATCH_SIZE + 1; i++) await receiveWebhook(f.c, signed(event(f.note(), 'charge.failed', { status: 'failed' })));
    assert.equal(f.calls.length, 0);
    f.linked();
    await processPending(f.c, orderId);
    const overview = await recoveryOverview(f.c);
    assert.equal(overview.events.length, 1);
    assert.equal(overview.events[0].outcome, 'pending_link');
    assert.equal(overview.events[0].stored_link_id, linkId);
    await processPending(f.c, orderId);
    assert.equal((await recoveryOverview(f.c)).events.length, 0);
    assert.equal(f.order().status, 'awaiting_payment');
});
test('recovery limits are five checks, sixty seconds and ten events with cooldown enforced around its boundary', async () => {
    assert.equal(VERIFICATION_LIMIT, 5); assert.equal(VERIFICATION_COOLDOWN_MS, 60000); assert.equal(REPLAY_BATCH_SIZE, 10);
    const f = fixture(); f.linked(); const e = event(f.note());
    f.handler(async () => { throw new Error('outage'); });
    await receiveWebhook(f.c, signed(e)); assert.equal(f.calls.length, 1);
    f.sqlite.prepare("UPDATE nomod_audit SET created_at=? WHERE type='provider_verification'").run(new Date(Date.now() - 59000).toISOString());
    await processPending(f.c, orderId); assert.equal(f.calls.length, 1);
    f.sqlite.prepare("UPDATE nomod_audit SET created_at=? WHERE type='provider_verification'").run(new Date(Date.now() - 61000).toISOString());
    await processPending(f.c, orderId); assert.equal(f.calls.length, 2);
    assert.equal(f.order().status, 'awaiting_payment');
});

test('approved custom quotes preserve fils and record staff approval atomically', async () => {
    const f = fixture(); f.sqlite.exec("UPDATE promotions SET status='requested',amount=NULL");
    assert.equal(await approvePromotionQuote(f.c.db, orderId, '137.65', 'admin-user'), 'approved');
    assert.equal(f.order().status, 'quoted'); assert.equal(f.order().amount, 137.65);
    const approval = f.sqlite.prepare("SELECT * FROM nomod_audit WHERE type='quote_approval'").get()!;
    assert.equal(approval.actor_id, 'admin-user'); assert.equal(approval.outcome, 'approved_AED_137.65');
    assert.equal(f.calls.length, 0);
    const before = { ...f.order() };
    for (const amount of ['1e2', '-1', '0', '100.001', '100000.01', true, null, 'NaN']) {
        assert.equal(await approvePromotionQuote(f.c.db, orderId, amount, 'admin-user'), 'invalid');
        assert.deepEqual({ ...f.order() }, before);
    }
    assert.equal(paymentMoney(137.65).replaceAll('\u00a0', ' '), 'AED 137.65');
    assert.equal(paymentMoney(137).replaceAll('\u00a0', ' '), 'AED 137.00');
    assert.equal(paymentMoney(NaN), 'Quote needs review'); assert.equal(paymentMoney(137, 'USD'), 'Quote needs review');
});
test('quote approval audit failure rolls back the quote; amounts lock once checkout is reserved', async () => {
    const f = fixture();
    f.sqlite.exec("CREATE TRIGGER reject_quote_audit BEFORE INSERT ON nomod_audit WHEN NEW.type='quote_approval' BEGIN SELECT RAISE(ABORT,'mock audit unavailable'); END");
    await assert.rejects(approvePromotionQuote(f.c.db, orderId, '200', 'admin'));
    assert.equal(f.order().amount, 100);
    f.sqlite.exec('DROP TRIGGER reject_quote_audit');
    f.handler(async () => { throw new Error('timeout'); });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'));
    // Even an inconsistent legacy status cannot authorize a second amount/link.
    f.sqlite.exec("UPDATE promotions SET status='quoted'");
    assert.equal(await approvePromotionQuote(f.c.db, orderId, '200', 'admin'), 'unavailable');
    assert.equal(f.order().amount, 100);
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /reconciliation/);
    assert.equal(f.calls.length, 1);
});
test('real order API ignores seller-supplied prices and restricts audited quote approval to admins', async () => {
    const f = fixture(); Object.assign(routeState.env, { DB: f.c.db, ADMIN_EMAILS: 'admin@example.test' });
    const market = await route('app/api/market/route.ts');
    routeState.user = { userId: 'seller', email: 'seller@example.test' };
    const requested = await market.POST(apiRequest('/api/market', { action: 'promotion', listingId: 'listing', packageId: 'boost', amount: 0.01 }));
    assert.equal(requested.status, 201); const { id } = await requested.json();
    const row = f.sqlite.prepare('SELECT * FROM promotions WHERE id=?').get(id)!;
    assert.equal(row.amount, null); assert.equal(row.status, 'requested');
    assert.equal((await market.POST(apiRequest('/api/market', { action: 'quote', id, amount: '137.65' }))).status, 403);
    routeState.user = { userId: 'admin', email: 'admin@example.test' };
    assert.equal((await market.POST(apiRequest('/api/market', { action: 'quote', id, amount: '137.65' }))).status, 200);
    assert.equal(f.sqlite.prepare('SELECT amount FROM promotions WHERE id=?').get(id)!.amount, 137.65);
    assert.equal(f.sqlite.prepare("SELECT actor_id FROM nomod_audit WHERE order_id=? AND type='quote_approval'").get(id)!.actor_id, 'admin');
    assert.equal(f.calls.length, 0);
});
test('a temporarily unlisted charge remains pending and can reconcile after provider consistency catches up', async () => {
    const f = fixture(); f.linked(); const e = event(f.note());
    f.handler(async () => Response.json({ count: 0, next: null, results: [] }));
    await receiveWebhook(f.c, signed(e));
    assert.equal(f.event(e.eventId).outcome, 'pending_provider'); assert.equal(f.order().status, 'awaiting_payment');
    f.sqlite.exec("UPDATE nomod_audit SET created_at='2000-01-01T00:00:00.000Z' WHERE type='provider_verification'");
    f.handler(async () => Response.json({ count: 1, next: null, results: [charge(f.note())] }));
    await reconcilePayment(f.c, orderId, undefined, 'admin');
    assert.equal(f.event(e.eventId).outcome, 'applied'); assert.equal(f.order().status, 'paid');
});
test('financial transitions, failures, refunds and disputes have an idempotent correlated audit trail', async () => {
    const f = fixture(); f.linked();
    const before = f.sqlite.prepare('SELECT * FROM listings').get();
    for (const type of ['charge.failed', 'charge.completed', 'charge.partially_refunded', 'charge.refunded', 'charge.dispute.created']) {
        const e = event(f.note(), type); await receiveWebhook(f.c, signed(e)); await receiveWebhook(f.c, signed(e));
        const rows = f.sqlite.prepare("SELECT * FROM nomod_audit WHERE type=? AND outcome LIKE ?").all('webhook:' + type, e.eventId + ':%');
        assert.equal(rows.length, 1); assert.equal(rows[0].link_id, linkId);
    }
    assert.equal(f.order().status, 'disputed');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM listings').get(), before, 'payment must not activate a listing or fulfill advertising');
    const overview = await recoveryOverview(f.c);
    assert.equal(overview.recent.length, 5);
    assert.ok(overview.recent.every(e => e.charge_id === chargeId));
    assert.doesNotMatch(JSON.stringify(overview), /mock-api-key|whsec_|card_number|payment_url/);
});
test('dashboard labels legacy paid rows as unverified until a matching payment binding exists', async () => {
    const f = fixture(); f.linked('paid'); Object.assign(routeState.env, { DB: f.c.db, ADMIN_EMAILS: 'admin@example.test' });
    routeState.user = { userId: 'seller', email: 'seller@example.test' };
    const market = await route('app/api/market/route.ts');
    let data = await (await market.GET(new Request(PAYMENT_ORIGIN + '/api/market?scope=me'))).json();
    assert.equal(data.promotions[0].verifiedPayment, 0);
    assert.equal(paymentStatusCopy('paid', !!data.promotions[0].verifiedPayment).title, 'Payment needs review');
    f.sqlite.prepare('INSERT INTO nomod_payments VALUES (?,?,?,?)').run(orderId, chargeId, linkId, new Date().toISOString());
    data = await (await market.GET(new Request(PAYMENT_ORIGIN + '/api/market?scope=me'))).json();
    assert.equal(data.promotions[0].verifiedPayment, 1);
    assert.equal(paymentStatusCopy('paid', !!data.promotions[0].verifiedPayment).title, 'Payment verified');
});
test('checkout redirects reject unsafe schemes and lookalike destinations', () => {
    assert.equal(safeCheckoutDestination('https://pay.nomodapp.com/en/l/mock'), 'https://pay.nomodapp.com/en/l/mock');
    for (const url of ['javascript:alert(1)', 'https://nomodapp.com.evil.test/x', 'http://pay.nomod.com/x', 'https://user:password@pay.nomod.com/x', 'https://pay.nomod.com:8443/x', undefined]) assert.throws(() => safeCheckoutDestination(url));
});
test('custom checkout takes its exact amount only from the staff-approved quote', async () => {
    const f = fixture();
    assert.equal(await approvePromotionQuote(f.c.db, orderId, '137.65', 'admin'), 'approved');
    f.handler(async (url, init) => {
        if (init?.method === 'POST') {
            const payload = JSON.parse(String(init.body)); f.setNote(payload.note);
            assert.equal(payload.items[0].amount, '137.65');
            assert.equal(payload.success_url, `${PAYMENT_ORIGIN}/account?payment=returned&promotion=${orderId}`);
            return Response.json(link(payload.note, { amount: '137.65' }));
        }
        return Response.json({ count: 1, next: null, results: [charge(f.note(), { total: '137.65' })] });
    });
    await createCheckout(f.c, orderId, 'seller');
    await receiveWebhook(f.c, signed(event(f.note(), 'charge.completed', { originalTotal: '137.65' })));
    assert.equal(f.order().status, 'paid'); assert.equal(f.order().amount, 137.65);
    assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 1);
});
test('failed/cancelled charge identifiers do not reserve settlement or prevent a later successful charge', async () => {
    for (const type of ['charge.failed', 'charge.cancelled']) {
        const f = fixture(); f.linked(); const failedId = randomUUID();
        f.handler(async url => Response.json({ count: 1, next: null, results: [charge(f.note(), {
            id: new URL(url).searchParams.get('id'), status: new URL(url).searchParams.get('id') === failedId ? 'failed' : 'paid',
        })] }));
        await receiveWebhook(f.c, signed(event(f.note(), type, { id: failedId, status: 'failed' })));
        assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_payments').get()!.n, 0);
        assert.equal(f.order().status, 'awaiting_payment');
        await receiveWebhook(f.c, signed(event(f.note())));
        assert.equal(f.order().status, 'paid');
        assert.equal(f.sqlite.prepare('SELECT charge_id FROM nomod_payments').get()!.charge_id, chargeId);
        assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 0);
    }
});
test('read-only dashboards remain available without Nomod migration while payment features fail closed', async () => {
    const f = fixture(false); Object.assign(routeState.env, { DB: f.c.db });
    routeState.user = { userId: 'seller', email: 'seller@example.test' };
    const market = await route('app/api/market/route.ts');
    const response = await market.GET(new Request(PAYMENT_ORIGIN + '/api/market?scope=me'));
    assert.equal(response.status, 200); assert.equal((await response.json()).promotions[0].verifiedPayment, 0);
    await assert.rejects(recoveryOverview(f.c), /migration/);
    assert.equal(f.calls.length, 0);
});
test('duplicate release-disabled deliveries preserve one durable pending outcome without audit spam', async () => {
    const f = fixture(); f.linked(); f.c.enabled = false;
    const e = event(f.note()); await receiveWebhook(f.c, signed(e));
    const first = f.event(e.eventId);
    await receiveWebhook(f.c, signed(e)); await processPending(f.c, orderId);
    assert.deepEqual(f.event(e.eventId), first);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM nomod_audit WHERE type='webhook:charge.completed'").get()!.n, 1);
    assert.equal(f.calls.length, 0);
});

test('checkout rejects social, video and unknown packages before creating or reusing a provider link', async () => {
    for (const packageId of ['story', 'reel', 'shoot', 'unknown', 'BOOST', 'boost ']) {
        for (const linked of [false, true]) {
            const f = fixture();
            f.sqlite.prepare('UPDATE promotions SET package_id=?').run(packageId);
            if (linked) f.linked();
            const before = { ...f.order() };
            await assert.rejects(createCheckout(f.c, orderId, 'seller'), /only for website ads/);
            assert.deepEqual({ ...f.order() }, before);
            assert.equal(f.calls.length, 0);
            assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_attempts').get()!.n, 0);
            assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_audit').get()!.n, 0);
            f.sqlite.close();
        }
    }
});

test('checkout reservation rechecks website-ad eligibility atomically before any provider request', async () => {
    const f = fixture(), batch = f.c.db.batch.bind(f.c.db);
    let changed = false;
    f.c.db.batch = async statements => {
        if (!changed) { changed = true; f.sqlite.exec("UPDATE promotions SET package_id='reel'"); }
        return batch(statements);
    };
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /already being prepared/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.order().status, 'quoted');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_attempts').get()!.n, 0);
    f.sqlite.close();
});

test('online quote approval refuses video/social requests without changing their stored quotation or audit history', async () => {
    for (const packageId of ['story', 'reel', 'shoot', 'unknown']) {
        const f = fixture();
        f.sqlite.prepare('UPDATE promotions SET package_id=?').run(packageId);
        const before = { ...f.order() };
        assert.equal(await approvePromotionQuote(f.c.db, orderId, '137.65', 'admin'), 'unavailable');
        assert.deepEqual({ ...f.order() }, before);
        assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_audit').get()!.n, 0);
        assert.equal(f.calls.length, 0);
        f.sqlite.close();
    }
});

test('seller service enquiries remain available while real admin API refuses payable quotes for video/social work', async () => {
    const f = fixture(); Object.assign(routeState.env, { DB: f.c.db, ADMIN_EMAILS: 'admin@example.test' });
    const market = await route('app/api/market/route.ts');
    for (const packageId of ['story', 'reel', 'shoot']) {
        routeState.user = { userId: 'seller', email: 'seller@example.test' };
        const requested = await market.POST(apiRequest('/api/market', { action: 'promotion', listingId: 'listing', packageId, amount: 0.01 }));
        assert.equal(requested.status, 201);
        const { id } = await requested.json();
        const before = f.sqlite.prepare('SELECT * FROM promotions WHERE id=?').get(id)!;
        assert.equal(before.status, 'requested'); assert.equal(before.amount, null);
        routeState.user = { userId: 'admin', email: 'admin@example.test' };
        const response = await market.POST(apiRequest('/api/market', { action: 'quote', id, amount: '137.65' }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /Only website ads/);
        assert.deepEqual(f.sqlite.prepare('SELECT * FROM promotions WHERE id=?').get(id), before);
    }
    assert.equal(f.calls.length, 0);
    f.sqlite.close();
});

test('historic non-website payments keep verified completion, refund, dispute and duplicate protections', async () => {
    for (const packageId of ['story', 'reel', 'shoot']) {
        const f = fixture(); f.sqlite.prepare('UPDATE promotions SET package_id=?').run(packageId); f.linked();
        const listing = f.sqlite.prepare('SELECT * FROM listings').get();
        const completed = event(f.note());
        await receiveWebhook(f.c, signed(completed)); await receiveWebhook(f.c, signed(completed));
        assert.equal(f.order().status, 'paid');
        const status = await sellerPaymentStatus(f.c.db, orderId, 'seller');
        assert.equal(status!.verified, true); assert.equal(status!.packageId, packageId);
        await receiveWebhook(f.c, signed(event(f.note(), 'charge.refunded')));
        assert.equal(f.order().status, 'refunded');
        await receiveWebhook(f.c, signed(event(f.note())));
        assert.equal(f.order().status, 'refunded');
        await receiveWebhook(f.c, signed(event(f.note(), 'charge.dispute.created')));
        assert.equal(f.order().status, 'disputed');
        assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM nomod_payments').get()!.n, 1);
        assert.deepEqual(f.sqlite.prepare('SELECT * FROM listings').get(), listing);
        assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 0);
        f.sqlite.close();
    }
});

test('historic non-website ambiguous checkout recovery adopts only the original link and never creates another', async () => {
    const f = fixture();
    f.handler(async (_url, init) => { f.setNote(JSON.parse(String(init!.body)).note); throw new Error('mock timeout'); });
    await assert.rejects(createCheckout(f.c, orderId, 'seller'));
    f.sqlite.exec("UPDATE promotions SET package_id='reel'");
    f.handler(async url => {
        assert.ok(url.endsWith('/links/' + linkId));
        return Response.json(link(f.note()));
    });
    await reconcilePayment(f.c, orderId, linkId, 'admin');
    assert.equal(f.order().nomod_id, linkId);
    assert.equal(f.order().status, 'awaiting_payment');
    await assert.rejects(createCheckout(f.c, orderId, 'seller'), /only for website ads/);
    assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 1, 'only the original mocked attempt');
    f.sqlite.close();
});
