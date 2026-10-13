import { receiveWebhook } from '@/lib/nomod';
import { nomodContext, paymentFailure } from '@/lib/nomod-server';

export async function POST(request: Request) {
    try { return Response.json(await receiveWebhook(nomodContext(), request)); }
    catch (error) { return paymentFailure(error); }
}
