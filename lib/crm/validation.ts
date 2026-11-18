import { z } from 'zod';
import { normalizePhone } from './phone.ts';
import { AUTHORIZATION, BUYER_STATUSES, CONTACT_METHODS, CRM_CATEGORIES, DOCUMENT_VERIFICATION, EMIRATES, LISTING_STATUSES, ROLES, SELLER_RELATIONSHIP, SELLER_STATUSES, SELLER_VERIFICATION, SOURCES } from './constants.ts';
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.preprocess(v => v === '' || v === undefined ? null : v, z.string().trim().max(max).nullable());
const optionalEmail = z.preprocess(v => v === '' || v === undefined ? null : v, z.string().trim().toLowerCase().email('Enter a valid email address.').max(160).nullable());
const optionalDate = z.preprocess(v => v === '' || v === undefined ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').refine(v => !Number.isNaN(Date.parse(v + 'T00:00:00Z')), 'Use a valid date.').nullable());
const optionalMoney = z.preprocess(v => v === '' || v === undefined || v === null ? null : Number(v), z.number({ invalid_type_error: 'Enter an amount in AED.' }).finite().min(0, 'Amounts cannot be negative.').max(1e10).refine(v => Math.round(v * 100) === v * 100, 'Use at most two decimal places.').nullable());
const choice = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values as unknown as [T[number], ...T[number][]]);
const optionalChoice = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(v => v === '' || v === undefined ? null : v, choice(values).nullable());
const category = z.string().refine(v => CRM_CATEGORIES.includes(v), 'Choose a business category.');
const optionalCategory = z.preprocess(v => v === '' || v === undefined ? null : v, category.nullable());
const emirate = z.string().refine(v => EMIRATES.includes(v), 'Choose an emirate.');
const optionalEmirate = z.preprocess(v => v === '' || v === undefined ? null : v, emirate.nullable());
const phone = z.string().trim().max(30).refine(v => normalizePhone(v) !== null, 'Enter a valid phone number (UAE numbers, or include the country code).');
const name = text(100).min(2, 'Enter a name.');
const staffEmail = optionalEmail;
const mediaLinks = z.preprocess(v => typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : v ?? [], z.array(z.string().url('Use full https:// links for photos/videos.').max(400).refine(u => u.startsWith('https://'), 'Use https:// links.')).max(20));
const budgetCheck = (v: { budget_min?: number | null; budget_max?: number | null }, c: z.RefinementCtx) => { if (v.budget_min != null && v.budget_max != null && v.budget_min > v.budget_max)
    c.addIssue({ code: 'custom', path: ['budget_max'], message: 'Maximum budget must be at least the minimum budget.' }); };
export const buyerFields = {
    enquiry_date: optionalDate, name, phone, email: optionalEmail, source: choice(SOURCES), category: optionalCategory, emirate: optionalEmirate, area: optionalText(100),
    budget_min: optionalMoney, budget_max: optionalMoney, requirements: optionalText(4000), contact_method: optionalChoice(CONTACT_METHODS), assigned_to: staffEmail,
    last_contact_date: optionalDate, next_follow_up_date: optionalDate, status: choice(BUYER_STATUSES), internal_notes: optionalText(6000),
};
export const sellerFields = {
    enquiry_date: optionalDate, contact_name: name, phone, email: optionalEmail, business_name: optionalText(140), business_type: optionalCategory, emirate: optionalEmirate, area: optionalText(100),
    asking_price: optionalMoney, monthly_rent: optionalMoney, estimated_monthly_profit: optionalMoney, relationship: optionalChoice(SELLER_RELATIONSHIP), verification_status: choice(SELLER_VERIFICATION),
    business_details: optionalText(4000), source: choice(SOURCES), assigned_to: staffEmail, next_follow_up_date: optionalDate, status: choice(SELLER_STATUSES), internal_notes: optionalText(6000),
};
export const listingFields = {
    seller_id: z.string().uuid('Choose the seller this listing belongs to.'), business_name: text(140).min(2, 'Enter the business name.'), category, emirate, area: optionalText(100),
    asking_price: optionalMoney, monthly_rent: optionalMoney, operating_costs: optionalMoney, estimated_profit: optionalMoney, description: optionalText(6000), media_links: mediaLinks,
    document_verification: choice(DOCUMENT_VERIFICATION), authorization_status: choice(AUTHORIZATION), assigned_to: staffEmail, availability: optionalText(120), status: choice(LISTING_STATUSES), internal_notes: optionalText(6000),
};
export const buyerCreate = z.object(buyerFields).superRefine(budgetCheck);
export const buyerUpdate = z.object(buyerFields).partial().superRefine(budgetCheck);
export const sellerCreate = z.object(sellerFields);
export const sellerUpdate = z.object(sellerFields).partial();
export const listingCreate = z.object(listingFields);
export const listingUpdate = z.object(listingFields).partial();
export const SCHEMAS = { buyer: { create: buyerCreate, update: buyerUpdate }, seller: { create: sellerCreate, update: sellerUpdate }, listing: { create: listingCreate, update: listingUpdate } };
export const staffInput = z.object({ email: z.string().trim().toLowerCase().email().max(160), name: text(100).min(2), role: z.enum(ROLES), active: z.boolean().default(true) });
const consent = z.literal(true, { errorMap: () => ({ message: 'Please agree to be contacted about your enquiry.' }) });
export const publicBuyerInput = z.object({
    name, phone, email: optionalEmail, category, emirate, area: optionalText(100), budget_min: optionalMoney, budget_max: optionalMoney,
    requirements: text(3000).min(10, 'Tell us a little about the business you are looking for.'), contact_method: choice(CONTACT_METHODS), consent,
}).superRefine(budgetCheck);
export const publicSellerInput = z.object({
    contact_name: name, phone, email: optionalEmail, business_name: text(140).min(2, 'Enter the business name.'), business_type: category, emirate, area: optionalText(100),
    asking_price: optionalMoney, monthly_rent: optionalMoney, estimated_monthly_profit: optionalMoney, relationship: choice(SELLER_RELATIONSHIP),
    business_details: text(3000).min(10, 'Tell us a little about the business.'), consent,
});
export function firstIssue(error: z.ZodError) { const i = error.issues[0]; return i ? i.message : 'Check the form and try again.'; }
