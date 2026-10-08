import { Browse } from '@/components/marketplace';
import { inventory, viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Commercial Properties for Sale & Rent in the UAE', 'Explore offices, retail shops, warehouses, showrooms and commercial buildings for sale or rent across Dubai, Abu Dhabi and the UAE.', '/properties');
export default async function Page() { const [data, v] = await Promise.all([inventory(), viewer()]); return <div className="container category-page"><div className="category-page-heading"><span className="eyebrow">SPACE FOR YOUR NEXT MOVE</span><h1>Commercial properties.</h1><p>Find an office, a shop, a warehouse or your next business space. Search across the UAE and connect directly with the seller.</p></div><Browse {...data} viewer={v} category="property"/></div>; }
