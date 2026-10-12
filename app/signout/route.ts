import { SESSION_COOKIE } from '@/app/auth';
export async function GET(request: Request) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return new Response(null, { status: 302, headers: { 'Cache-Control': 'private, no-store', Location: '/', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}` } });
}
