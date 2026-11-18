import { PublicEnquiryForm } from '@/components/crm/public-enquiry';
import { meta } from '@/lib/pages';
import { setting } from '@/lib/server';
export const dynamic = 'force-dynamic';
export const metadata = meta('Looking to Buy a Business in the UAE?', 'Tell Poomas FZE LLC what business you want to buy, your budget and preferred emirate. Our team will contact you with suitable businesses for sale.', '/enquiry/buyer');
export default function Page() {
    return <div className="seller-layout container">
        <div className="seller-intro"><span className="eyebrow">BUSINESS FOR SALE · BUYER ENQUIRY</span><h1>Find a business to buy.</h1><p>Share your requirements and budget. Our team will contact you with suitable businesses across the UAE.</p><p className="muted">Matching suggestions are not a guarantee of availability or financial performance. Always verify details before committing.</p></div>
        <PublicEnquiryForm kind="buyer" siteKey={setting('TURNSTILE_SITE_KEY')} />
    </div>;
}
