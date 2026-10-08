import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, isAdmin, failure } from '@/lib/server';
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { id } = await params;
    const row = await database().prepare('SELECT m.*,l.status,l.images FROM media m LEFT JOIN listings l ON l.id=m.listing_id WHERE m.id=?').bind(id).first<{
        owner_id: string;
        status: string;
        images: string | null;
    }>();
    if (!row)
        return new Response('Not found', { status: 404 });
    const publicMedia = ['published', 'sold'].includes(row.status) && JSON.parse(row.images || '[]').includes(`/api/media/${id}`);
    if (!publicMedia) {
        const user = await getChatGPTUser();
        if (!user || (user.userId !== row.owner_id && !isAdmin(user.email)))
            return new Response('Not found', { status: 404 });
    }
    const file = await env.BUCKET?.get(id);
    if (!file)
        return new Response('Not found', { status: 404 });
    return new Response(file.body, { headers: { 'Content-Type': file.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
catch (e) {
    return failure(e);
} }
