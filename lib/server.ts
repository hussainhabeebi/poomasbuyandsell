import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export function database() { if (!env.DB)
    throw new Error('Storage is temporarily unavailable. Please try again.'); return env.DB; }
export function setting(key: string) { return (env as unknown as Record<string, string>)[key] || ''; }
export async function identity() { const user = await getChatGPTUser(); if (!user)
    throw new HttpError('Please sign in to continue.', 401); return user; }
export function isAdmin(email: string) { return setting('ADMIN_EMAILS').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase()); }
export class HttpError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export function failure(error: unknown) { if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status }); console.error('Poomas operation failed', error); return Response.json({ error: 'This service is temporarily unavailable. Your changes were not confirmed. Please try again.' }, { status: 503 }); }
export function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin || origin !== new URL(request.url).origin)
    throw new HttpError('Invalid request origin.', 403); }
export async function body(request: Request) { if (Number(request.headers.get('content-length') || 0) > 30000)
    throw new HttpError('Request is too large.', 413); const raw = await request.text(); if (raw.length > 30000)
    throw new HttpError('Request is too large.', 413); try {
    return JSON.parse(raw);
}
catch {
    throw new HttpError('Invalid request.', 400);
} }
export async function rateLimit(userId: string, action: string, max = 20) { const key = `${action}:${userId}`, window = Math.floor(Date.now() / 3600000); const row = await database().prepare('INSERT INTO rate_limits (key,count,window) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count').bind(key, window).first<{
    count: number;
}>(); if (row && row.count > max)
    throw new HttpError('You have reached the hourly limit. Please try again later.', 429); }
