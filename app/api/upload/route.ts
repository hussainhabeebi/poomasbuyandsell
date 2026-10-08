import { env } from 'cloudflare:workers';
import { identity, database, sameOrigin, failure, HttpError, rateLimit } from '@/lib/server';
export async function POST(request: Request) { try {
    sameOrigin(request);
    const user = await identity();
    await rateLimit(user.userId, 'upload', 40);
    if (!env.BUCKET)
        throw new Error('Uploads unavailable');
    if (Number(request.headers.get('content-length') || 0) > 8500000)
        throw new HttpError('Photos must be smaller than 8 MB.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 8000000 || !file.size || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new HttpError('Upload a JPG, PNG or WebP photo under 8 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : file.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!valid)
        throw new HttpError('The photo format could not be recognised.');
    const id = crypto.randomUUID();
    await env.BUCKET.put(id, bytes, { httpMetadata: { contentType: file.type } });
    try {
        await database().prepare('INSERT INTO media (id,owner_id,content_type,created_at) VALUES (?,?,?,?)').bind(id, user.userId, file.type, new Date().toISOString()).run();
    }
    catch (e) {
        await env.BUCKET.delete(id);
        throw e;
    }
    return Response.json({ url: `/api/media/${id}` }, { status: 201 });
}
catch (e) {
    return failure(e);
} }
