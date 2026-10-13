import { database, setting, failure, HttpError } from '@/lib/server';
import { NOMOD_RELEASE_APPROVED, PaymentError, type NomodContext } from './nomod.ts';

export function nomodContext(): NomodContext {
    return {
        db: database(), request: fetch,
        enabled: NOMOD_RELEASE_APPROVED && setting('NOMOD_PAYMENTS_ENABLED') === 'true',
        apiKey: setting('NOMOD_API_KEY'), webhookSecret: setting('NOMOD_WEBHOOK_SECRET'),
        returnOrigin: setting('PAYMENT_RETURN_ORIGIN'),
    };
}
export function paymentFailure(error: unknown) {
    return failure(error instanceof PaymentError ? new HttpError(error.message, error.status) : error);
}
