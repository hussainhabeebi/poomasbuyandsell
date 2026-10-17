import { Home } from '@/components/marketplace';
import { inventory, viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('UAE Commercial Properties & Vehicles', 'Browse commercial properties for sale and rent, and vehicles for sale across the UAE. Choose an emirate and connect with sellers.', '/marketplace');
export default async function Page() {
    const [data, v] = await Promise.all([inventory(), viewer()]);
    return <Home {...data} viewer={v}/>;
}
