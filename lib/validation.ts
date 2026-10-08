import { z } from 'zod';
import { EMIRATES, TYPES } from './catalog.ts';
export const listingInput = z.object({ title: z.string().trim().min(8).max(120), category: z.enum(['property', 'vehicle']), subtype: z.string().min(2).max(40), emirate: z.string().refine(x => EMIRATES.includes(x)), area: z.string().trim().min(2).max(90), price: z.coerce.number().finite().positive().max(1e10), intent: z.enum(['sale', 'rent']), description: z.string().trim().min(40).max(6000), phone: z.string().trim().regex(/^\+?[0-9\s()-]{8,22}$/), sellerName: z.string().trim().min(2).max(80), specs: z.record(z.string().max(300)).refine(x => Object.keys(x).length <= 16), images: z.array(z.string().regex(/^\/api\/media\/[a-f0-9-]{36}$/)).min(1).max(8).refine(x => new Set(x).size === x.length, 'Each photo must be unique.'), video: z.string().max(300).optional().default(''), permit: z.string().trim().max(120).optional().default('') }).superRefine((v, c) => { if (!TYPES[v.category].includes(v.subtype))
    c.addIssue({ code: 'custom', path: ['subtype'], message: 'Select a valid listing type.' }); if (v.video && !safeVideo(v.video))
    c.addIssue({ code: 'custom', path: ['video'], message: 'Use a YouTube or Instagram video link.' }); if (v.category === 'vehicle' && v.intent === 'rent')
    c.addIssue({ code: 'custom', path: ['intent'], message: 'Vehicles are currently available for sale only.' }); });
export function safeVideo(value: string) { try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'youtu.be', 'www.instagram.com', 'instagram.com'].includes(u.hostname);
}
catch {
    return false;
} }
export const enquiryInput = z.object({ listingId: z.string().uuid(), phone: z.string().regex(/^\+?[0-9\s()-]{8,22}$/), message: z.string().trim().min(10).max(2000), kind: z.enum(['enquiry', 'viewing', 'test-drive', 'offer']).default('enquiry') });
export function paymentMatches(data: {
    currency?: string;
    originalCurrency?: string;
    originalTotal?: string;
    total?: string;
    status?: string;
    note?: string;
}, order: {
    currency: string;
    amount: number;
    id: string;
}) { return data.status === 'paid' && (data.originalCurrency || data.currency) === order.currency && Number(data.originalTotal || data.total) === order.amount && data.note === `Poomas promotion ${order.id}`; }
