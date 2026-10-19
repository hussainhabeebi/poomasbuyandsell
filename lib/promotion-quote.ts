import { paymentMinor } from './nomod.ts';
import { WEBSITE_AD_PACKAGE_ID } from './payment-policy.ts';

// Authorization belongs to the existing admin-only API. No seller-provided
// amount is used when requesting an order or creating provider checkout.
export async function approvePromotionQuote(db: D1Database, id: unknown, amount: unknown, actor: string) {
    const minor = paymentMinor(amount);
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || minor === null || minor <= 0 || minor > 10000000) return 'invalid';
    const result = await db.batch([
        db.prepare(`UPDATE promotions SET amount=?,status='quoted' WHERE id=? AND currency='AED' AND package_id=?
            AND status IN ('requested','quoted') AND nomod_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM nomod_attempts WHERE order_id=?)`).bind(minor / 100, id, WEBSITE_AD_PACKAGE_ID, id),
        db.prepare(`INSERT INTO nomod_audit (id,order_id,type,outcome,actor_id,created_at)
            SELECT ?,?,'quote_approval',?,?,? WHERE changes()=1`)
            .bind(crypto.randomUUID(), id, `approved_AED_${(minor / 100).toFixed(2)}`, actor, new Date().toISOString()),
    ]);
    return result[0].meta.changes ? 'approved' : 'unavailable';
}
