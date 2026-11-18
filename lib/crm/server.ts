// Server glue between Worker routes and the CRM data layer.
import { database, failure, HttpError, identity, setting } from '@/lib/server';
import { getUser } from '@/app/auth';
import { CrmError, resolveRole, type Actor, type DB } from './repo.ts';
export function crmDb(): DB { return database() as unknown as DB; }
export function adminEmails() { return setting('ADMIN_EMAILS'); }
export async function crmActor(): Promise<Actor & { userId: string; name: string }> {
    const user = await identity();
    const role = await resolveRole(crmDb(), user.email, adminEmails());
    if (!role)
        throw new HttpError('CRM access is limited to authorized Poomas staff.', 403);
    return { email: user.email.toLowerCase(), role, userId: user.userId, name: user.displayName };
}
// For server components: returns null instead of throwing.
export async function crmViewer() {
    const user = await getUser();
    if (!user)
        return { user: null, role: null };
    try {
        return { user, role: await resolveRole(crmDb(), user.email, adminEmails()) };
    }
    catch (e) {
        console.error('CRM role lookup failed', e);
        return { user, role: null, unavailable: true };
    }
}
export function crmFailure(e: unknown) {
    if (e instanceof CrmError)
        return Response.json({ error: e.message, ...(e.details ? { details: e.details } : {}) }, { status: e.status, headers: { 'Cache-Control': 'private, no-store' } });
    return failure(e);
}
export const PRIVATE = { 'Cache-Control': 'private, no-store' };
