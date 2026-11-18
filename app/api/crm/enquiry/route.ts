import { body, rateLimit, sameOrigin, setting, HttpError } from '@/lib/server';
import { crmDb, crmFailure } from '@/lib/crm/server';
import { createPublicEnquiry } from '@/lib/crm/repo';
import { verifyTurnstile } from '@/lib/crm/turnstile';
// Public Buyer / Seller enquiry forms. No sign-in; protected by same-origin
// checks, Cloudflare Turnstile, a honeypot field and a per-IP hourly limit.
export async function POST(request: Request) { try {
    sameOrigin(request);
    const input = await body(request);
    if (input.kind !== 'buyer' && input.kind !== 'seller')
        throw new HttpError('Choose a buyer or seller enquiry.');
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    await rateLimit(`ip:${ip}`, 'crm-enquiry', 10);
    if (typeof input.website === 'string' && input.website.trim())
        return Response.json({ message: 'Thank you. Our team will contact you shortly.' });
    const check = await verifyTurnstile(input.turnstileToken, setting('TURNSTILE_SECRET_KEY'), ip === 'unknown' ? null : ip);
    if (check === 'unconfigured' || check === 'unavailable')
        throw new HttpError('The enquiry form is temporarily unavailable. Please contact us on WhatsApp or try again later.', 503);
    if (check !== 'ok')
        throw new HttpError('Please complete the security check and try again.', 400);
    await createPublicEnquiry(crmDb(), input.kind, input.data);
    return Response.json({ message: 'Thank you. Our team will contact you shortly.' }, { status: 201 });
}
catch (e) {
    return crmFailure(e);
} }
