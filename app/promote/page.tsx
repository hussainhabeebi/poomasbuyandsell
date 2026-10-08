import { PromotionPage } from '@/components/marketplace';
import { viewer, meta } from '@/lib/pages';
export const dynamic = 'force-dynamic';
export const metadata = meta('Promote Your Property or Vehicle with Ajeesh', 'Request an Instagram story, presenter-led reel, video shoot or marketplace spotlight for your UAE property or vehicle. Quotes confirmed before payment.', '/promote');
export default async function Page() { return <PromotionPage viewer={await viewer()}/>; }
