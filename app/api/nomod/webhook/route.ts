import { verifyNomodSignature, nextPaymentState } from '@/lib/webhook';
import { database, setting, failure, HttpError } from '@/lib/server';
import { paymentMatches } from '@/lib/validation';
export async function POST(request: Request) { try {
    const secret = setting('NOMOD_WEBHOOK_SECRET');
    if (!secret)
        throw new HttpError('Webhook not configured.', 503);
    const raw = await request.text();
    if (raw.length > 1000000)
        throw new HttpError('Payload too large.', 413);
    if (!verifyNomodSignature(raw, { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') }, secret))
        throw new HttpError('Invalid webhook signature or timestamp.', 400);
    const event = JSON.parse(raw);
    if (!event.eventId || typeof event.type !== 'string')
        throw new HttpError('Invalid event.', 400);
    const d = event.data || {}, db = database();
    if (!/^Poomas promotion [a-f0-9-]{36}$/.test(String(d.note || '')))
        return Response.json({ ok: true });
    const orderId = d.note.slice('Poomas promotion '.length);
    const order = await db.prepare('SELECT * FROM promotions WHERE id=?').bind(orderId).first<{
        id: string;
        currency: string;
        amount: number;
        status: string;
        nomod_id: string;
    }>();
    if (!order)
        return Response.json({ ok: true });
    const seen = await db.prepare('SELECT id FROM webhook_events WHERE id=?').bind(event.eventId).first();
    if (seen)
        return Response.json({ ok: true });
    const status = nextPaymentState(event.type, order.status, paymentMatches(d, order));
    if (!status)
        return Response.json({ ok: true });
    const allowed = status === 'paid' ? ['awaiting_payment'] : ['awaiting_payment', 'paid', 'partially_refunded', 'disputed'];
    await db.batch([db.prepare(`UPDATE promotions SET status=? WHERE id=? AND status IN (${allowed.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM webhook_events WHERE id=?)`).bind(status, order.id, ...allowed, event.eventId), db.prepare('INSERT OR IGNORE INTO webhook_events (id,created_at) VALUES (?,?)').bind(event.eventId, new Date().toISOString())]);
    return Response.json({ ok: true });
}
catch (e) {
    return failure(e);
} }
