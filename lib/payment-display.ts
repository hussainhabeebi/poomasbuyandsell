export const CHECKOUT_ORDER_KEY = 'poomas:checkout-promotion';
export function paymentMoney(amount: number, currency = 'AED') {
    if (currency !== 'AED' || !Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) return 'Quote needs review';
    return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
export function safeCheckoutDestination(value: unknown) {
    if (typeof value !== 'string') throw new Error('Checkout destination could not be verified. Contact the team.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['nomod.com', 'nomodapp.com'].some(d => url.hostname === d || url.hostname.endsWith('.' + d))) throw new Error('Checkout destination could not be verified. Contact the team.');
    return url.href;
}
export function paymentStatusCopy(status: string, verified: boolean, lastAttempt: string | null = null) {
    if (['paid', 'partially_refunded', 'refunded', 'disputed'].includes(status)) {
        if (!verified) return { title: 'Payment needs review', message: 'The stored payment record requires team verification. No new payment is needed while this is reviewed.', pending: false };
        if (status === 'paid') return { title: 'Payment verified', message: 'Your promotion payment is confirmed. Service delivery and scheduling are handled separately by the team.', pending: false };
        if (status === 'refunded') return { title: 'Payment refunded', message: 'A full refund has been recorded. Contact the team about your promotion.', pending: false };
        if (status === 'partially_refunded') return { title: 'Partial refund recorded', message: 'A partial refund has been recorded. The team will confirm the remaining service scope.', pending: false };
        return { title: 'Payment disputed', message: 'A payment dispute has been recorded. Contact the team before proceeding with the promotion.', pending: false };
    }
    if (status === 'creating_payment') return { title: 'Payment setup needs verification', message: 'The team must verify the existing historical payment attempt. Contact the team on WhatsApp; do not make another payment while it is reviewed.', pending: true };
    if (lastAttempt === 'attempt_failed' || lastAttempt === 'attempt_cancelled') return { title: lastAttempt === 'attempt_failed' ? 'Payment attempt failed' : 'Payment attempt cancelled', message: 'No successful payment is confirmed. Contact the team on WhatsApp to review this historical payment attempt and discuss your promotion. Online payments are disabled.', pending: true };
    if (status === 'awaiting_payment') return { title: 'Awaiting payment confirmation', message: 'A return from Nomod does not confirm payment. We are checking the status saved by verified payment notifications.', pending: true };
    return { title: 'No verified payment recorded', message: 'Contact the team on WhatsApp to discuss your promotion and any direct payment arrangements. Returning to this page does not mark a promotion paid.', pending: false };
}
