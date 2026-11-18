import { body, rateLimit, sameOrigin, HttpError } from '@/lib/server';
import { crmActor, crmDb, crmFailure, adminEmails, PRIVATE } from '@/lib/crm/server';
import { createRecord, crmTotals, findDuplicates, getRecord, listRecords, updateRecord } from '@/lib/crm/repo';
import { isEntityType } from '@/lib/crm/entities';
import { SEARCH_KEYS, type SearchFilters } from '@/lib/crm/search';
export async function GET(request: Request) { try {
    const actor = await crmActor(), db = crmDb(), url = new URL(request.url), type = url.searchParams.get('type');
    if (url.searchParams.get('totals') === '1')
        return Response.json({ totals: await crmTotals(db, actor) }, { headers: PRIVATE });
    const phone = url.searchParams.get('phoneCheck');
    if (phone !== null)
        return Response.json({ duplicates: await findDuplicates(db, phone.slice(0, 30)) }, { headers: PRIVATE });
    if (!isEntityType(type))
        throw new HttpError('Choose buyers, sellers or listings.');
    const id = url.searchParams.get('id');
    if (id)
        return Response.json(await getRecord(db, type, id.slice(0, 64), actor), { headers: PRIVATE });
    const filters: SearchFilters = {};
    for (const k of SEARCH_KEYS) {
        const v = url.searchParams.get(k);
        if (v)
            filters[k] = v.slice(0, 160);
    }
    return Response.json(await listRecords(db, type, filters, actor, Number(url.searchParams.get('page') || 0)), { headers: PRIVATE });
}
catch (e) {
    return crmFailure(e);
} }
export async function POST(request: Request) { try {
    sameOrigin(request);
    const actor = await crmActor(), input = await body(request);
    await rateLimit(actor.userId, 'crm-write', 300);
    if (!isEntityType(input.type))
        throw new HttpError('Choose buyers, sellers or listings.');
    const opts = { confirmDuplicate: input.confirmDuplicate === true };
    if (input.action === 'create')
        return Response.json(await createRecord(crmDb(), input.type, input.data, actor, adminEmails(), opts), { status: 201, headers: PRIVATE });
    if (input.action === 'update' && typeof input.id === 'string')
        return Response.json(await updateRecord(crmDb(), input.type, input.id, input.data, actor, adminEmails(), opts), { headers: PRIVATE });
    throw new HttpError('Unknown action.');
}
catch (e) {
    return crmFailure(e);
} }
