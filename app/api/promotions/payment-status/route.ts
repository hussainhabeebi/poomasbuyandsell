import { identity, database, failure } from '@/lib/server';
import { sellerPaymentStatus } from '@/lib/payment-status';

export async function GET(request: Request) {
    try {
        const user = await identity();
        const result = await sellerPaymentStatus(database(), new URL(request.url).searchParams.get('id') || '', user.userId);
        if (!result) return Response.json({ error: 'Promotion not found in your account.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
        return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return failure(error); }
}
