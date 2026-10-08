import { SellForm } from '@/components/marketplace';
import { viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('List Your Commercial Property or Vehicle in the UAE', 'Create a property or vehicle listing on Poomas Buy & Sell. Upload photos, add a video and connect with UAE buyers.', '/sell');
export default async function Page() { return <SellForm viewer={await viewer()}/>; }
