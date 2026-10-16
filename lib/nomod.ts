import { nextPaymentState, verifyNomodSignature } from './webhook.ts';
import { PACKAGES } from './catalog.ts';

// Deliberate release lock. Configuration alone must not activate this unverified
// merchant integration. Removing it requires a separately reviewed activation.
export const NOMOD_RELEASE_APPROVED = false;
export const PAYMENT_ORIGIN = 'https://www.poomasbuyandsell.com';
const API = 'https://api.nomod.com/v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES = new Set(['charge.created', 'charge.authorised', 'charge.completed', 'charge.failed', 'charge.cancelled', 'charge.refunded', 'charge.partially_refunded', 'charge.dispute.created']);
const PENDING = "('received','pending_link','pending_provider','pending_activation')";
export const VERIFICATION_LIMIT = 5;
export const VERIFICATION_COOLDOWN_MS = 60000;
export const REPLAY_BATCH_SIZE = 10;

export class PaymentError extends Error {
    status: number;
    constructor(message: string, status = 503) { super(message); this.status = status; }
}
export interface NomodContext {
    db: D1Database;
    request: typeof fetch;
    enabled: boolean;
    apiKey: string;
    webhookSecret: string;
    returnOrigin: string;
}
interface Order {
    id: string; owner_id: string; status: string; listing_status?: string;
    amount: number; currency: string; package_id: string;
    nomod_id: string | null; payment_url: string | null;
}
interface Attempt { order_id: string; id: string; note: string; state: string; link_id: string | null }
interface Event {
    id: string; type: string; object_id: string; charge_id: string; order_id: string | null;
    link_id: string | null; reference_id: string | null; note: string; amount: string;
    currency: string; charge_status: string; provider_created_at: string | null;
    outcome: string;
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function text(value: unknown, max = 300): string {
    return typeof value === 'string' && value.length <= max ? value : '';
}
// Integer minor units; accept Nomod's three-decimal examples only when the
// fractional mill is zero. No rounding, exponent notation or currency fallback.
export function paymentMinor(value: unknown): number | null {
    const s = typeof value === 'number' ? String(value) : value;
    if (typeof s !== 'string' || !/^\d{1,9}(?:\.\d{1,2}0*|\.0+)?$/.test(s)) return null;
    const [whole, fraction = ''] = s.split('.');
    const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    return Number.isSafeInteger(result) ? result : null;
}
export function paymentConfigured(c: NomodContext): boolean {
    return c.enabled && !!c.apiKey && /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(c.webhookSecret) && c.returnOrigin === PAYMENT_ORIGIN;
}
function requireConfigured(c: NomodContext) {
    if (!paymentConfigured(c)) throw new PaymentError('Online promotion payments are disabled. Your quotation remains saved.');
}
export async function requirePaymentSchema(c: NomodContext) {
    const row = await c.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('nomod_attempts','nomod_events','nomod_payments','nomod_audit')").first<{ count: number }>();
    if (row?.count !== 4) throw new PaymentError('Payment storage requires an approved migration. Payments remain disabled.');
}
function audit(c: NomodContext, orderId: string, type: string, outcome: string, linkId: string | null = null, actor: string | null = null) {
    return c.db.prepare('INSERT INTO nomod_audit (id,order_id,type,outcome,link_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), orderId, type, outcome, linkId, actor, new Date().toISOString());
}
async function provider(c: NomodContext, path: string, init: RequestInit = {}): Promise<RecordValue> {
    requireConfigured(c);
    try {
        const response = await c.request(API + path, {
            ...init, redirect: 'error', headers: { 'X-API-KEY': c.apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        });
        // All creation failures are ambiguous; never release the creation lock.
        if (!response.ok) throw new Error('Provider unavailable');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid provider response');
        return data as RecordValue;
    } catch {
        // Never surface provider bodies, credentials or customer/card data.
        throw new PaymentError('Payment setup could not be verified. An administrator must reconcile this request before retrying.');
    }
}
function matchingAmount(amount: unknown, currency: unknown, order: Order): boolean {
    const expected = paymentMinor(order.amount);
    return expected !== null && expected > 0 && currency === order.currency && order.currency === 'AED' && paymentMinor(amount) === expected;
}
function safeLink(data: RecordValue, order: Order, note: string, expectedId?: string): { id: string; url: string } {
    const id = text(data.id), url = text(data.url, 1000);
    let target: URL;
    try { target = new URL(url); } catch { throw new PaymentError('Invalid payment-link response. Administrator reconciliation is required.'); }
    if (!UUID.test(id) || (expectedId && id !== expectedId) || !text(data.reference_id) ||
        data.note !== note || !matchingAmount(data.amount, data.currency, order) ||
        data.status !== 'enabled' || (data.payment_block_reason !== null && data.payment_block_reason !== undefined) ||
        target.protocol !== 'https:' || target.username || target.password || target.port ||
        !['nomod.com', 'nomodapp.com'].some(d => target.hostname === d || target.hostname.endsWith('.' + d))) {
        throw new PaymentError('Payment-link details are not eligible for checkout. Administrator reconciliation is required.');
    }
    return { id, url };
}
async function storeLink(c: NomodContext, order: Order, attempt: Attempt, link: { id: string; url: string }, actor: string | null) {
    // Conditional adoption is atomic with the attempt/audit. Concurrent recovery
    // may not replace a link that was already saved by checkout.
    await c.db.batch([
        c.db.prepare("UPDATE promotions SET nomod_id=?,payment_url=?,status='awaiting_payment' WHERE id=? AND status='creating_payment' AND nomod_id IS NULL AND EXISTS (SELECT 1 FROM nomod_attempts WHERE order_id=? AND id=? AND state IN ('sending','ambiguous'))")
            .bind(link.id, link.url, order.id, order.id, attempt.id),
        c.db.prepare("UPDATE nomod_attempts SET link_id=?,state='linked',updated_at=? WHERE order_id=? AND id=? AND EXISTS (SELECT 1 FROM promotions WHERE id=? AND nomod_id=?)")
            .bind(link.id, new Date().toISOString(), order.id, attempt.id, order.id, link.id),
        audit(c, order.id, actor ? 'reconciliation' : 'checkout', 'link_adoption_checked', link.id, actor),
    ]);
    const saved = await c.db.prepare('SELECT nomod_id FROM promotions WHERE id=?').bind(order.id).first<{ nomod_id: string }>();
    if (saved?.nomod_id !== link.id) throw new PaymentError('Checkout changed during reconciliation. No replacement link was saved.', 409);
    await processPending(c, order.id);
}
export async function createCheckout(c: NomodContext, orderId: string, sellerId: string) {
    requireConfigured(c);
    if (!UUID.test(orderId)) throw new PaymentError('Invalid promotion request.', 400);
    await requirePaymentSchema(c);
    const order = await c.db.prepare('SELECT p.*,l.status AS listing_status FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.id=? AND p.owner_id=?')
        .bind(orderId, sellerId).first<Order>();
    if (!order || !['quoted', 'awaiting_payment'].includes(order.status) || !matchingAmount(order.amount, order.currency, order))
        throw new PaymentError('Your promotion needs an approved quotation before payment.', 400);
    if (order.listing_status !== 'published') throw new PaymentError('Your listing must be approved before payment.', 400);
    const previous = await c.db.prepare('SELECT * FROM nomod_attempts WHERE order_id=?').bind(order.id).first<Attempt>();
    if (order.nomod_id) {
        if (!UUID.test(order.nomod_id)) throw new PaymentError('Stored payment identifier requires administrator review.');
        // Revalidate existing links; never return a stale, disabled or blocked URL.
        const data = await provider(c, `/links/${encodeURIComponent(order.nomod_id)}`);
        const link = safeLink(data, order, previous?.note || `Poomas promotion ${order.id}`, order.nomod_id);
        await processPending(c, order.id);
        const state = await c.db.prepare('SELECT status FROM promotions WHERE id=?').bind(order.id).first<{ status: string }>();
        if (state?.status !== 'awaiting_payment') throw new PaymentError('This payment request has already been resolved.', 409);
        return link.url;
    }
    if (previous || order.status !== 'quoted') throw new PaymentError('An earlier checkout requires administrator reconciliation.', 409);
    const id = crypto.randomUUID(), note = `Poomas promotion ${order.id} attempt ${id}`, now = new Date().toISOString();
    // A permanent unique order_id reserves ONE provider creation attempt. Even
    // after timeout/crash, no automatic or manual reset can create another link.
    const results = await c.db.batch([
        c.db.prepare("INSERT OR IGNORE INTO nomod_attempts (order_id,id,note,state,created_at,updated_at) SELECT p.id,?,?,'sending',?,? FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.id=? AND p.status='quoted' AND p.nomod_id IS NULL AND p.amount=? AND p.currency=? AND p.owner_id=? AND l.status='published'")
            .bind(id, note, now, now, order.id, order.amount, order.currency, sellerId),
        c.db.prepare("UPDATE promotions SET status='creating_payment' WHERE id=? AND status='quoted' AND EXISTS (SELECT 1 FROM nomod_attempts WHERE order_id=? AND id=?)")
            .bind(order.id, order.id, id),
    ]);
    if (!results[0].meta.changes || !results[1].meta.changes) throw new PaymentError('Checkout is already being prepared.', 409);
    await audit(c, order.id, 'checkout', 'creation_reserved').run();
    try {
        const data = await provider(c, '/links', { method: 'POST', body: JSON.stringify({
            currency: order.currency, items: [{ name: PACKAGES.find(p => p.id === order.package_id)?.name || 'Poomas promotion', amount: (paymentMinor(order.amount)! / 100).toFixed(2), quantity: 1 }],
            title: 'Poomas Buy & Sell Promotion', note,
            success_url: `${PAYMENT_ORIGIN}/account?payment=returned&promotion=${order.id}`, failure_url: `${PAYMENT_ORIGIN}/account?payment=failed&promotion=${order.id}`,
            discount_percentage: 0, shipping_address_required: false, allow_tip: false, allow_tabby: false, allow_tamara: false, allow_service_fee: false, payment_expiry_limit: 1,
        }) });
        const link = safeLink(data, order, note);
        await storeLink(c, order, { order_id: order.id, id, note, state: 'sending', link_id: null }, link, null);
        const state = await c.db.prepare('SELECT status FROM promotions WHERE id=?').bind(order.id).first<{ status: string }>();
        if (state?.status !== 'awaiting_payment') throw new PaymentError('The payment has already been resolved. Check your account.', 409);
        return link.url;
    } catch (error) {
        await c.db.batch([
            c.db.prepare("UPDATE nomod_attempts SET state='ambiguous',updated_at=? WHERE order_id=? AND id=? AND state='sending'").bind(new Date().toISOString(), order.id, id),
            audit(c, order.id, 'checkout', 'reconciliation_required'),
        ]);
        if (error instanceof PaymentError) throw error;
        throw new PaymentError('Checkout could not be saved. Administrator reconciliation is required.');
    }
}

function normalizeEvent(value: unknown): Event {
    const e = record(value), d = record(e.data), note = text(d.note);
    if (!UUID.test(text(e.eventId)) || !text(e.type, 80) || !UUID.test(text(d.id)) || !text(e.objectId, 100))
        throw new PaymentError('Invalid webhook event.', 400);
    const match = /^Poomas promotion ([a-f0-9-]{36})(?: attempt ([a-f0-9-]{36}))?$/.exec(note);
    const created = text(d.created, 50);
    return {
        id: text(e.eventId), type: text(e.type, 80), object_id: text(e.objectId, 100), charge_id: text(d.id),
        order_id: match && UUID.test(match[1]) ? match[1] : null, link_id: null,
        reference_id: typeof d.referenceId === 'number' && Number.isSafeInteger(d.referenceId) ? String(d.referenceId) : null,
        note, amount: text(d.originalTotal ?? d.total, 50), currency: text(d.originalCurrency ?? d.currency, 3),
        charge_status: text(d.status, 40), provider_created_at: created && Number.isFinite(Date.parse(created)) ? created : null,
        outcome: 'received',
    };
}
export async function receiveWebhook(c: NomodContext, request: Request) {
    if (!c.webhookSecret) throw new PaymentError('Webhook not configured.');
    const raw = await request.text();
    if (raw.length > 1000000) throw new PaymentError('Payload too large.', 413);
    if (!verifyNomodSignature(raw, { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') }, c.webhookSecret))
        throw new PaymentError('Invalid webhook signature or timestamp.', 400);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new PaymentError('Invalid event JSON.', 400); }
    const e = normalizeEvent(value);
    await requirePaymentSchema(c);
    // Allowlist only identifiers and financial/state fields. Never persist raw
    // provider JSON: charge responses may contain customer or card information.
    await c.db.prepare('INSERT OR IGNORE INTO nomod_events (id,type,object_id,charge_id,order_id,reference_id,note,amount,currency,charge_status,provider_created_at,received_at,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(e.id, e.type, e.object_id, e.charge_id, e.order_id, e.reference_id, e.note, e.amount, e.currency, e.charge_status, e.provider_created_at, new Date().toISOString(), e.outcome).run();
    const stored = await c.db.prepare('SELECT * FROM nomod_events WHERE id=?').bind(e.id).first<Event>();
    if (!stored || ['type', 'object_id', 'charge_id', 'order_id', 'reference_id', 'note', 'amount', 'currency', 'charge_status'].some(k => stored[k as keyof Event] !== e[k as keyof Event]))
        throw new PaymentError('Conflicting provider event ID.', 409);
    const legacy = await c.db.prepare('SELECT id FROM webhook_events WHERE id=?').bind(e.id).first();
    if (legacy) await eventOutcome(c, e.id, 'legacy_duplicate');
    else await processEvent(c, e.id);
    return { ok: true };
}
async function eventOutcome(c: NomodContext, id: string, outcome: string, link: string | null = null) {
    await c.db.prepare(`UPDATE nomod_events SET outcome=?,link_id=COALESCE(?,link_id),processed_at=? WHERE id=? AND outcome IN ${PENDING}`)
        .bind(outcome, link, new Date().toISOString(), id).run();
}
export async function processEvent(c: NomodContext, id: string) {
    const e = await c.db.prepare(`SELECT * FROM nomod_events WHERE id=? AND outcome IN ${PENDING}`).bind(id).first<Event>();
    if (!e) return;
    if (!e.order_id || !TYPES.has(e.type)) { await eventOutcome(c, id, 'ignored'); return; }
    const order = await c.db.prepare('SELECT * FROM promotions WHERE id=?').bind(e.order_id).first<Order>();
    if (!order) { await eventOutcome(c, id, 'rejected_unknown_order'); return; }
    const attempt = await c.db.prepare('SELECT * FROM nomod_attempts WHERE order_id=?').bind(order.id).first<Attempt>();
    if (e.note !== (attempt?.note || `Poomas promotion ${order.id}`) || !matchingAmount(e.amount, e.currency, order) ||
        (e.type === 'charge.completed' && e.charge_status !== 'paid')) {
        await eventOutcome(c, id, 'rejected_reference_amount_currency', order.nomod_id); return;
    }
    if (!order.nomod_id) { await eventOutcome(c, id, 'pending_link'); return; }
    if (!paymentConfigured(c)) { await eventOutcome(c, id, 'pending_activation', order.nomod_id); return; }
    // Persist a bounded reservation BEFORE each provider lookup. A crash still
    // consumes an attempt. One atomic statement prevents concurrent deliveries
    // or operators from exceeding the budget/cooldown. Never clear this history.
    const now = new Date().toISOString();
    const reservation = await c.db.prepare(`INSERT INTO nomod_audit (id,order_id,type,outcome,link_id,created_at)
        SELECT ?,?,'provider_verification',?,?,? WHERE
        (SELECT COUNT(*) FROM nomod_audit WHERE order_id=? AND type='provider_verification' AND outcome=?) < ?
        AND NOT EXISTS (SELECT 1 FROM nomod_audit WHERE order_id=? AND type='provider_verification' AND outcome=? AND created_at>?)
        AND EXISTS (SELECT 1 FROM nomod_events WHERE id=? AND outcome IN ${PENDING})`)
        .bind(crypto.randomUUID(), order.id, id, order.nomod_id, now, order.id, id, VERIFICATION_LIMIT,
            order.id, id, new Date(Date.now() - VERIFICATION_COOLDOWN_MS).toISOString(), id).run();
    if (!reservation.meta.changes) return; // Durable pending state remains visible to operators.
    // Nomod does NOT document linkId in webhook data. The documented server API
    // filters charges by both charge UUID and link_id. Never trust note alone.
    let charges: RecordValue;
    try { charges = await provider(c, `/charges?id=${encodeURIComponent(e.charge_id)}&link_id=${encodeURIComponent(order.nomod_id)}&page_size=2`); }
    catch { await eventOutcome(c, id, 'pending_provider', order.nomod_id); return; }
    const results = Array.isArray(charges.results) ? charges.results.map(record) : [];
    const charge = results.find(d => d.id === e.charge_id);
    if (!charge || charges.count !== 1 || results.length !== 1 || charges.next !== null || charge.note !== e.note ||
        !matchingAmount(charge.total, charge.currency, order) || !Number.isSafeInteger(charge.reference_id) ||
        String(charge.reference_id) !== e.reference_id || (e.type === 'charge.completed' && charge.status !== 'paid')) {
        await eventOutcome(c, id, 'rejected_provider_match', order.nomod_id); return;
    }
    if (['charge.failed', 'charge.cancelled', 'charge.created', 'charge.authorised'].includes(e.type)) {
        // Attempt outcomes are audited without closing the Link or resetting the
        // order. A failed/voided authorisation is not a captured payment.
        await eventOutcome(c, id, e.type.replace('charge.', 'attempt_'), order.nomod_id); return;
    }
    const next = nextPaymentState(e.type, order.status, true);
    if (!next) { await eventOutcome(c, id, 'no_transition', order.nomod_id); return; }
    await c.db.batch([
        c.db.prepare(`INSERT OR IGNORE INTO nomod_payments (order_id,charge_id,link_id,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM promotions WHERE id=? AND status=?) AND EXISTS (SELECT 1 FROM nomod_events WHERE id=? AND outcome IN ${PENDING})`)
            .bind(order.id, e.charge_id, order.nomod_id, now, order.id, order.status, id),
        c.db.prepare(`UPDATE promotions SET status=? WHERE id=? AND status=? AND nomod_id=? AND EXISTS (SELECT 1 FROM nomod_payments WHERE order_id=? AND charge_id=? AND link_id=?) AND EXISTS (SELECT 1 FROM nomod_events WHERE id=? AND outcome IN ${PENDING})`)
            .bind(next, order.id, order.status, order.nomod_id, order.id, e.charge_id, order.nomod_id, id),
        c.db.prepare(`UPDATE nomod_events SET outcome=CASE WHEN changes()=1 THEN 'applied' WHEN EXISTS (SELECT 1 FROM nomod_payments WHERE order_id=? AND charge_id<>?) THEN 'rejected_charge_conflict' ELSE 'pending_provider' END,link_id=?,processed_at=? WHERE id=? AND outcome IN ${PENDING}`)
            .bind(order.id, e.charge_id, order.nomod_id, now, id),
    ]);
}
export async function processPending(c: NomodContext, orderId: string) {
    // Exclude cooling-down/exhausted events so they cannot starve later events.
    const events = await c.db.prepare(`SELECT e.id FROM nomod_events e WHERE e.order_id=? AND e.outcome IN ${PENDING}
        AND (SELECT COUNT(*) FROM nomod_audit a WHERE a.order_id=e.order_id AND a.type='provider_verification' AND a.outcome=e.id) < ?
        AND NOT EXISTS (SELECT 1 FROM nomod_audit a WHERE a.order_id=e.order_id AND a.type='provider_verification' AND a.outcome=e.id AND a.created_at>?)
        ORDER BY e.received_at,e.id LIMIT ?`)
        .bind(orderId, VERIFICATION_LIMIT, new Date(Date.now() - VERIFICATION_COOLDOWN_MS).toISOString(), REPLAY_BATCH_SIZE).all<{ id: string }>();
    for (const e of events.results) await processEvent(c, e.id);
}
// Caller must authenticate and authorise an administrator. Recovery can adopt
// an existing verified link, never clear a reservation or create a second one.
export async function reconcilePayment(c: NomodContext, orderId: string, linkId: string | undefined, actor: string) {
    requireConfigured(c);
    if (!UUID.test(orderId) || (linkId !== undefined && !UUID.test(linkId))) throw new PaymentError('Invalid reconciliation identifiers.', 400);
    await requirePaymentSchema(c);
    const order = await c.db.prepare('SELECT * FROM promotions WHERE id=?').bind(orderId).first<Order>();
    if (!order) throw new PaymentError('Promotion not found.', 404);
    const attempt = await c.db.prepare('SELECT * FROM nomod_attempts WHERE order_id=?').bind(orderId).first<Attempt>();
    try {
        if (!order.nomod_id) {
            if (!attempt || order.status !== 'creating_payment' || !linkId) throw new PaymentError('Locate the original attempted link in Nomod before reconciliation. No new link may be created.', 409);
            const data = await provider(c, `/links/${encodeURIComponent(linkId)}`);
            // A disabled link can already have completed payment. Adopt only its
            // verified identifiers for event replay, never expose it for checkout.
            const validationData = data.status === 'disabled' ? { ...data, status: 'enabled' } : data;
            const link = safeLink(validationData, order, attempt.note, linkId);
            await storeLink(c, order, attempt, link, actor);
        } else {
            if (linkId && linkId !== order.nomod_id) throw new PaymentError('A saved payment link cannot be replaced.', 409);
            await processPending(c, orderId);
        }
        await audit(c, orderId, 'reconciliation', 'pending_events_checked', order.nomod_id || linkId || null, actor).run();
    } catch (error) {
        await audit(c, orderId, 'reconciliation', 'rejected_or_unavailable', order.nomod_id || linkId || null, actor).run();
        throw error;
    }
    return { ok: true, message: 'Recovery pass finished. Check event outcomes; cooling-down or exhausted events remain pending. No new payment link was created.' };
}

// Read-only operator view. Only call after administrator authorization. No raw
// payloads, customer information, credentials or payment URLs are returned.
export async function recoveryOverview(c: NomodContext, page = 0) {
    await requirePaymentSchema(c);
    const events = await c.db.prepare(`SELECT e.id,e.order_id,e.type,e.outcome,e.received_at,e.processed_at,e.link_id,
        p.status AS order_status,p.nomod_id AS stored_link_id,p.package_id,l.title,
        (SELECT COUNT(*) FROM nomod_audit a WHERE a.order_id=e.order_id AND a.type='provider_verification' AND a.outcome=e.id) AS attempts,
        (SELECT MAX(created_at) FROM nomod_audit a WHERE a.order_id=e.order_id AND a.type='provider_verification' AND a.outcome=e.id) AS last_attempt_at
        FROM nomod_events e LEFT JOIN promotions p ON p.id=e.order_id LEFT JOIN listings l ON l.id=p.listing_id
        WHERE e.outcome IN ${PENDING} OR e.outcome LIKE 'rejected_%'
        ORDER BY e.received_at,e.id LIMIT 51 OFFSET ?`).bind(page * 50).all();
    const attempts = await c.db.prepare(`SELECT p.id AS order_id,p.status,p.package_id,l.title,a.id AS attempt_id,a.state,a.updated_at
        FROM nomod_attempts a JOIN promotions p ON p.id=a.order_id JOIN listings l ON l.id=p.listing_id
        WHERE p.nomod_id IS NULL AND a.state IN ('sending','ambiguous') ORDER BY a.created_at,a.id LIMIT 51 OFFSET ?`)
        .bind(page * 50).all();
    return { enabled: paymentConfigured(c), verificationLimit: VERIFICATION_LIMIT, cooldownMs: VERIFICATION_COOLDOWN_MS,
        batchSize: REPLAY_BATCH_SIZE, events: events.results.slice(0, 50), attempts: attempts.results.slice(0, 50),
        hasMore: events.results.length > 50 || attempts.results.length > 50, page };
}
