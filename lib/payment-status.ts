const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface SellerPaymentStatus {
    id: string;
    title: string;
    packageId: string;
    amount: number | null;
    currency: string;
    status: string;
    verified: boolean;
    lastAttempt: string | null;
}
// Ownership is enforced in SQL. URL hints select an order, never its state.
export async function sellerPaymentStatus(db: D1Database, id: string, sellerId: string): Promise<SellerPaymentStatus | null> {
    if (!UUID.test(id)) return null;
    return db.prepare(`SELECT p.id,l.title,p.package_id AS packageId,p.amount,p.currency,p.status,
        EXISTS (SELECT 1 FROM nomod_payments n WHERE n.order_id=p.id AND n.link_id=p.nomod_id) AS verified,
        (SELECT e.outcome FROM nomod_events e WHERE e.order_id=p.id AND e.link_id=p.nomod_id
            AND e.outcome IN ('attempt_failed','attempt_cancelled') ORDER BY e.received_at DESC,e.id DESC LIMIT 1) AS lastAttempt
        FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.id=? AND p.owner_id=?`)
        .bind(id, sellerId).first<SellerPaymentStatus>().then(row => row ? { ...row, verified: !!row.verified } : null);
}
