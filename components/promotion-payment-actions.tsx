'use client';
import { useEffect, useState } from 'react';
import { paymentMoney } from '../lib/payment-display';
import { isWebsiteAdPackage } from '../lib/payment-policy';

// Read-only application status; never generates a link or contacts Nomod.
// A failed, malformed or unavailable response must leave checkout hidden.
export function usePaymentAvailability(active = true) {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        setEnabled(false);
        if (!active) return;
        const controller = new AbortController();
        fetch('/api/checkout', { cache: 'no-store', signal: controller.signal })
            .then(async response => {
                if (!response.ok) return false;
                const result: unknown = await response.json();
                return result !== null && typeof result === 'object' &&
                    'paymentsEnabled' in result && result.paymentsEnabled === true;
            })
            .then(value => { if (!controller.signal.aborted) setEnabled(value); })
            .catch(() => { if (!controller.signal.aborted) setEnabled(false); });
        return () => controller.abort();
    }, [active]);
    return enabled;
}

export function PromotionPaymentActions({ promotion, admin, busy, paymentsEnabled, onQuote, onCheckout }: {
    promotion: Record<string, unknown>;
    admin: boolean;
    busy: boolean;
    paymentsEnabled: boolean;
    onQuote: () => void;
    onCheckout: () => void;
}) {
    const websiteAd = isWebsiteAdPackage(promotion.package_id);
    const status = String(promotion.status);
    const payable = ['quoted', 'awaiting_payment'].includes(status);
    const hasAmount = promotion.amount !== null && promotion.amount !== undefined;
    return <div>
        {hasAmount ? <strong>{paymentMoney(Number(promotion.amount), typeof promotion.currency === 'string' ? promotion.currency : 'AED')}</strong> : <span>Quote pending</span>}
        {!websiteAd ? <p>New online payments are available only for website ads. Contact the team about this service.</p> : <>
            {['requested', 'quoted'].includes(status) && <p>Agree the ad placement, duration, price and cancellation/refund terms with the team before payment.</p>}
            {admin && ['requested', 'quoted'].includes(status) && <button type="button" className="button outline" disabled={busy} onClick={onQuote}>Set website-ad quote</button>}
            {!admin && payable && (paymentsEnabled
                ? <button type="button" className="button primary" disabled={busy} onClick={onCheckout}>{busy ? 'Opening checkout…' : 'Pay with Nomod'}</button>
                : <p role="status">Online payments are not available yet. Your quotation remains saved.</p>)}
        </>}
    </div>;
}
