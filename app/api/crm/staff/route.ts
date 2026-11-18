import { body, rateLimit, sameOrigin } from '@/lib/server';
import { crmActor, crmDb, crmFailure, adminEmails, PRIVATE } from '@/lib/crm/server';
import { listStaff, upsertStaff } from '@/lib/crm/repo';
export async function GET() { try {
    const actor = await crmActor();
    return Response.json({ staff: await listStaff(crmDb(), actor, adminEmails()), role: actor.role, email: actor.email }, { headers: PRIVATE });
}
catch (e) {
    return crmFailure(e);
} }
export async function POST(request: Request) { try {
    sameOrigin(request);
    const actor = await crmActor();
    await rateLimit(actor.userId, 'crm-staff', 60);
    return Response.json(await upsertStaff(crmDb(), await body(request), actor, adminEmails()), { headers: PRIVATE });
}
catch (e) {
    return crmFailure(e);
} }
