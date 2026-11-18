import { requireUser } from '@/app/auth';
import { crmViewer } from '@/lib/crm/server';
import { CrmApp } from '@/components/crm/crm-app';
import { meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('CRM', 'Poomas business-for-sale CRM for authorized staff.', '/admin/crm', true);
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams, one = (v: unknown) => typeof v === 'string' ? v.slice(0, 64) : undefined;
    await requireUser('/admin/crm');
    const { user, role, unavailable } = await crmViewer();
    if (unavailable)
        return <div className="container page-space"><h1>CRM temporarily unavailable.</h1><p>The CRM database is not ready yet. If this is a new installation, the CRM migration must be applied first.</p></div>;
    if (!user || !role)
        return <div className="container page-space"><h1>CRM access required.</h1><p>This account is not an authorized Poomas staff member. Ask an administrator to add your Google email address to the CRM team.</p></div>;
    return <CrmApp role={role} email={user.email.toLowerCase()} initialTab={one(params.tab)} initialId={one(params.id)} />;
}
