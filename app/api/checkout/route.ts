import { identity, sameOrigin, body, rateLimit, HttpError } from '@/lib/server';
import { createCheckout, paymentConfigured, NOMOD_RELEASE_APPROVED } from '@/lib/nomod';
import { nomodContext, paymentFailure } from '@/lib/nomod-server';

// Read-only readiness probe. It exposes no credentials or binding metadata and
// lets deployment verification establish the payment-disabled release safely.
export async function GET() {
    return Response.json({ paymentsEnabled: NOMOD_RELEASE_APPROVED && paymentConfigured(nomodContext()) }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}

export async function POST(request: Request) {
    try {
        sameOrigin(request);
        const user = await identity();
        const context = nomodContext();
        if (!paymentConfigured(context)) throw new HttpError('Online promotion payments are disabled. Your quotation remains saved.', 503);
        const input = await body(request);
        if (typeof input?.id !== 'string') throw new HttpError('Invalid promotion request.');
        await rateLimit(user.userId, 'checkout', 10);
        const url = await createCheckout(context, input.id, user.userId);
        return Response.json({ url });
    } catch (error) { return paymentFailure(error); }
}
