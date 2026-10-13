import { identity, isAdmin, sameOrigin, body, HttpError, rateLimit } from '@/lib/server';
import { reconcilePayment } from '@/lib/nomod';
import { nomodContext, paymentFailure } from '@/lib/nomod-server';

export async function POST(request: Request) {
    try {
        sameOrigin(request);
        const user = await identity();
        if (!isAdmin(user.email)) throw new HttpError('Administrator access required.', 403);
        const input = await body(request);
        if (typeof input?.id !== 'string' || (input.linkId !== undefined && typeof input.linkId !== 'string')) throw new HttpError('Invalid reconciliation request.');
        await rateLimit(user.userId, 'payment_reconciliation', 10);
        return Response.json(await reconcilePayment(nomodContext(), input.id, input.linkId, user.userId));
    } catch (error) { return paymentFailure(error); }
}
