import { Browse } from '@/components/marketplace';
import { inventory, viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Cars & Commercial Vehicles for Sale in the UAE', 'Find cars, SUVs, pickups, vans, trucks and motorcycles for sale in the UAE. Compare seller details and request a test drive.', '/vehicles');
export default async function Page() { const [data, v] = await Promise.all([inventory(), viewer()]); return <div className="container category-page"><div className="category-page-heading"><span className="eyebrow">THE ROAD STARTS HERE</span><h1>Find your next vehicle.</h1><p>From everyday cars to commercial vehicles. Compare the details, ask the right questions and arrange a test drive.</p></div><Browse {...data} viewer={v} category="vehicle"/></div>; }
