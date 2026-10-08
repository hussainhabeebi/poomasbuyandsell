import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifyNomodSignature(raw: string, headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
}, secret: string, now = Date.now()) {
    const { id, timestamp, signature } = headers;
    if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300)
        return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest();
    return signature.split(' ').some(x => { const [v, s] = x.split(','); if (v !== 'v1' || !s)
        return false; const got = Buffer.from(s, 'base64'); return got.length === expected.length && timingSafeEqual(got, expected); });
}
export function nextPaymentState(type: string, current: string, matched: boolean) {
    if (type === 'charge.completed')
        return matched && current === 'awaiting_payment' ? 'paid' : null;
    if (!['awaiting_payment', 'paid', 'partially_refunded', 'disputed'].includes(current))
        return null;
    if (type === 'charge.refunded')
        return 'refunded';
    if (type === 'charge.partially_refunded')
        return 'partially_refunded';
    if (type === 'charge.dispute.created')
        return 'disputed';
    return null;
}
