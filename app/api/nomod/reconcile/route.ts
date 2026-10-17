import { identity, isAdmin, sameOrigin, body, HttpError, rateLimit } from '@/lib/server';
import { reconcilePayment, recoveryOverview } from '@/lib/nomod';
import { nomodContext, paymentFailure } from '@/lib/nomod-server';

export async function GET(request: Request) {
    try {
        const user = await identity();
        if (!isAdmin(user.email)) throw new HttpError('Administrator access required.', 403);
        const page = Number(new URL(request.url).searchParams.get('page') || 0);
        if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new HttpError('Invalid recovery page.');
        return Response.json(await recoveryOverview(nomodContext(), page), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return paymentFailure(error); }
}

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
