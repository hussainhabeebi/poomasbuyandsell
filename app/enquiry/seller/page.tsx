import { PublicEnquiryForm } from '@/components/crm/public-enquiry';
import { meta } from '@/lib/pages';
import { setting } from '@/lib/server';
export const dynamic = 'force-dynamic';
export const metadata = meta('Sell Your Business in the UAE', 'Tell Poomas FZE LLC about the business you want to sell. Our team will contact you to verify details before any listing is published.', '/enquiry/seller');
export default function Page() {
    return <div className="seller-layout container">
        <div className="seller-intro"><span className="eyebrow">BUSINESS FOR SALE · SELLER ENQUIRY</span><h1>Sell your business.</h1><p>Tell us about your business. Our team will contact you and verify ownership or authorization before anything is published.</p><p className="muted">Your contact and financial details are kept private and are only visible to authorized Poomas staff.</p></div>
        <PublicEnquiryForm kind="seller" siteKey={setting('TURNSTILE_SITE_KEY')} />
    </div>;
}
