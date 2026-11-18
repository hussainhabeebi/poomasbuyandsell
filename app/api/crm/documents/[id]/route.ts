import { env } from 'cloudflare:workers';
import { crmActor, crmDb, crmFailure } from '@/lib/crm/server';
import { documentForDownload, documentKey } from '@/lib/crm/repo';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { try {
    const { id } = await params;
    const actor = await crmActor();
    if (!/^[a-f0-9-]{36}$/.test(id))
        return new Response('Not found', { status: 404 });
    const doc = await documentForDownload(crmDb(), actor, id);
    const file = await env.BUCKET?.get(documentKey(id));
    if (!file)
        return new Response('Not found', { status: 404 });
    return new Response(file.body, { headers: { 'Content-Type': doc.content_type, 'Content-Disposition': `attachment; filename="${doc.file_name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
catch (e) {
    return crmFailure(e);
} }
