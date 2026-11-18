import { env } from 'cloudflare:workers';
import { rateLimit, sameOrigin, HttpError } from '@/lib/server';
import { crmActor, crmDb, crmFailure, PRIVATE } from '@/lib/crm/server';
import { documentAccess, documentKey, recordDocument, safeFileName, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from '@/lib/crm/repo';
// Confidential seller/listing documents. Stored privately in R2 under
// crm-documents/ and never served publicly; administrators only.
export async function POST(request: Request) { try {
    sameOrigin(request);
    const actor = await crmActor();
    if (!env.BUCKET)
        throw new Error('Document storage unavailable');
    if (Number(request.headers.get('content-length') || 0) > DOCUMENT_MAX_BYTES + 100000)
        throw new HttpError('Documents must be smaller than 10 MB.', 413);
    const form = await request.formData();
    const entityType = await documentAccess(crmDb(), actor, form.get('entityType'), form.get('entityId'));
    await rateLimit(actor.userId, 'crm-document', 60);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > DOCUMENT_MAX_BYTES || !DOCUMENT_TYPES[file.type])
        throw new HttpError('Upload a PDF, JPG or PNG document under 10 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!DOCUMENT_TYPES[file.type](bytes))
        throw new HttpError('The document format could not be recognised.');
    const id = crypto.randomUUID();
    await env.BUCKET.put(documentKey(id), bytes, { httpMetadata: { contentType: file.type } });
    try {
        await recordDocument(crmDb(), actor, { id, entityType, entityId: String(form.get('entityId')), fileName: safeFileName(file.name), contentType: file.type, size: file.size });
    }
    catch (e) {
        await env.BUCKET.delete(documentKey(id));
        throw e;
    }
    return Response.json({ id }, { status: 201, headers: PRIVATE });
}
catch (e) {
    return crmFailure(e);
} }
