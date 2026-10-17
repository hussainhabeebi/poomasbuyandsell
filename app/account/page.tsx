import { Dashboard } from '@/components/marketplace';
import { requireUser } from '@/app/auth';
import { isAdmin } from '@/lib/server';
import { meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Your Account', 'Manage your Poomas listings, enquiries, saved listings and promotions.', '/account', true);
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const query = await searchParams, back = new URLSearchParams();
    if (typeof query.payment === 'string' && ['returned', 'failed'].includes(query.payment)) {
        back.set('payment', query.payment);
        if (typeof query.promotion === 'string' && /^[a-f0-9-]{36}$/i.test(query.promotion)) back.set('promotion', query.promotion);
    }
    const u = await requireUser('/account' + (back.size ? '?' + back.toString() : ''));
    return <Dashboard viewer={{ name: u.displayName, email: u.email, admin: isAdmin(u.email) }}/>;
}
