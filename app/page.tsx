import { Home } from '@/components/marketplace';
import { inventory, viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('UAE Commercial Properties & Vehicles', 'Buy, sell and discover commercial properties and vehicles in the UAE. Connect with sellers and book Ajeesh Instagram promotion services.', '/');
export default async function Page() { const [data, v] = await Promise.all([inventory(), viewer()]); return <Home {...data} viewer={v}/>; }
