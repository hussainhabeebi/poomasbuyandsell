import { database, identity, setting, sameOrigin, body, failure, HttpError, rateLimit } from '@/lib/server';
import { PACKAGES } from '@/lib/catalog';
export async function POST(request: Request) { try {
    sameOrigin(request);
    const user = await identity();
    if (!setting('NOMOD_API_KEY'))
        throw new HttpError('Online promotion payments are not available yet. Your quote remains saved in your account.', 503);
    const input = await body(request);
    await rateLimit(user.userId, 'checkout', 10);
    const db = database();
    const order = await db.prepare('SELECT p.*,l.status AS listing_status FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.id=? AND p.owner_id=?').bind(input.id, user.userId).first<{
        id: string;
        status: string;
        listing_status: string;
        package_id: string;
        amount: number;
        payment_url: string | null;
    }>();
    if (!order || !['quoted', 'awaiting_payment'].includes(order.status) || !order.amount)
        throw new HttpError('Your promotion needs a confirmed quote before payment.');
    if (order.listing_status !== 'published')
        throw new HttpError('Your listing must be approved before payment.');
    if (order.payment_url)
        return Response.json({ url: order.payment_url });
    const lock = await db.prepare("UPDATE promotions SET status='creating_payment' WHERE id=? AND status='quoted'").bind(order.id).run();
    if (!lock.meta.changes)
        throw new HttpError('Checkout is already being prepared. Please check your account shortly.', 409);
    const returnOrigin = setting('PAYMENT_RETURN_ORIGIN');
    if (!returnOrigin) {
        await db.prepare("UPDATE promotions SET status='quoted' WHERE id=?").bind(order.id).run();
        throw new HttpError('Checkout is not configured yet.', 503);
    }
    let response: Response;
    try {
        response = await fetch('https://api.nomod.com/v1/links', { method: 'POST', headers: { 'X-API-KEY': setting('NOMOD_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: 'AED', items: [{ name: PACKAGES.find(p => p.id === order.package_id)?.name || 'Poomas promotion', amount: Number(order.amount).toFixed(2), quantity: 1 }], title: 'Poomas Buy & Sell Promotion', note: `Poomas promotion ${order.id}`, success_url: `${returnOrigin}/account?payment=returned`, failure_url: `${returnOrigin}/account?payment=failed`, allow_tip: false, allow_tabby: false, allow_tamara: false, allow_service_fee: false, payment_expiry_limit: 1 }), signal: AbortSignal.timeout(20000) });
    }
    catch {
        throw new HttpError('Payment setup could not be confirmed. Please ask the team to check your request before retrying.', 503);
    }
    if (!response.ok) {
        await db.prepare("UPDATE promotions SET status='quoted' WHERE id=? AND status='creating_payment'").bind(order.id).run();
        throw new HttpError('The payment provider could not create checkout. Please try again later.', 502);
    }
    const data = await response.json() as {
        id: string;
        url: string;
        currency: string;
        amount: string;
    };
    if (!data.id || !data.url || data.currency !== 'AED' || Number(data.amount) !== Number(order.amount))
        throw new HttpError('Payment details could not be confirmed. Please contact the team.', 502);
    const target = new URL(data.url);
    if (target.protocol !== 'https:' || !['nomod.com', 'nomodapp.com'].some(d => target.hostname === d || target.hostname.endsWith('.' + d)))
        throw new Error('Unexpected payment URL');
    await db.prepare("UPDATE promotions SET nomod_id=?,payment_url=?,status='awaiting_payment' WHERE id=? AND status='creating_payment'").bind(data.id, data.url, order.id).run();
    return Response.json({ url: data.url });
}
catch (e) {
    return failure(e);
} }
