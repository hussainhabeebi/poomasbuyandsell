import { Dashboard } from '@/components/marketplace';
import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { isAdmin } from '@/lib/server';
import { meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Admin Review', 'Review marketplace submissions and promotion requests.', '/admin', true);
export default async function Page() { const u = await requireChatGPTUser('/admin'); if (!isAdmin(u.email))
    return <div className="container page-space"><h1>Administrator access required.</h1><p>This account does not have permission to review listings or promotion requests.</p></div>; return <Dashboard admin viewer={{ name: u.displayName, email: u.email, admin: true }}/>; }
