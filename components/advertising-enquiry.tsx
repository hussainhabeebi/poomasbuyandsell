import { MessageCircle } from 'lucide-react';

export function AdvertisingEnquiry({ requestId, promotionName }: { requestId?: string; promotionName?: string }) {
    const message = requestId
        ? `Hi Poomas, I’d like to discuss my advertising enquiry${promotionName ? ` for ${promotionName}` : ''} (request ${requestId}). Please confirm the options, pricing, timing and direct payment arrangements.`
        : 'Hi Poomas, I’m interested in advertising on your website. Please share the options and pricing.';
    return <a className="button primary" href={`https://wa.me/971558772494?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle size={18} aria-hidden="true"/>Enquire on WhatsApp
    </a>;
}
