import { Dashboard } from '@/components/marketplace';
import { requireUser } from '@/app/cloudflare-auth';
import { isAdmin } from '@/lib/server';
import { meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Your Account', 'Manage your Poomas listings, enquiries, saved listings and promotions.', '/account', true);
export default async function Page() { const u = await requireUser('/account'); return <Dashboard viewer={{ name: u.displayName, email: u.email, admin: isAdmin(u.email) }}/>; }
