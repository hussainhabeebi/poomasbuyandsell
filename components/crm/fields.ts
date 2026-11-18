import { AUTHORIZATION, BUYER_STATUSES, CONTACT_METHODS, CRM_CATEGORIES, DOCUMENT_VERIFICATION, EMIRATES, LISTING_STATUSES, SELLER_RELATIONSHIP, SELLER_STATUSES, SELLER_VERIFICATION, SOURCES } from '@/lib/crm/constants';
import type { EntityType } from '@/lib/crm/permissions';
export type FieldType = 'text' | 'email' | 'tel' | 'money' | 'date' | 'select' | 'textarea' | 'links' | 'seller' | 'staff';
export type Field = { key: string; label: string; type: FieldType; options?: readonly string[]; required?: boolean; wide?: boolean };
export const FORM_FIELDS: Record<EntityType, Field[]> = {
    buyer: [
        { key: 'name', label: 'Buyer name', type: 'text', required: true }, { key: 'phone', label: 'Phone / WhatsApp', type: 'tel', required: true },
        { key: 'email', label: 'Email (optional)', type: 'email' }, { key: 'enquiry_date', label: 'Enquiry date', type: 'date' },
        { key: 'source', label: 'Enquiry source', type: 'select', options: SOURCES, required: true }, { key: 'status', label: 'Status', type: 'select', options: BUYER_STATUSES, required: true },
        { key: 'category', label: 'Business category', type: 'select', options: CRM_CATEGORIES }, { key: 'emirate', label: 'Preferred emirate', type: 'select', options: EMIRATES },
        { key: 'area', label: 'Preferred area', type: 'text' }, { key: 'contact_method', label: 'Preferred contact method', type: 'select', options: CONTACT_METHODS },
        { key: 'budget_min', label: 'Minimum budget (AED)', type: 'money' }, { key: 'budget_max', label: 'Maximum budget (AED)', type: 'money' },
        { key: 'assigned_to', label: 'Assigned staff', type: 'staff' }, { key: 'last_contact_date', label: 'Last contact date', type: 'date' },
        { key: 'next_follow_up_date', label: 'Next follow-up date', type: 'date' },
        { key: 'requirements', label: 'Requirements', type: 'textarea', wide: true }, { key: 'internal_notes', label: 'Internal notes', type: 'textarea', wide: true },
    ],
    seller: [
        { key: 'contact_name', label: 'Owner / contact name', type: 'text', required: true }, { key: 'phone', label: 'Phone / WhatsApp', type: 'tel', required: true },
        { key: 'email', label: 'Email (optional)', type: 'email' }, { key: 'enquiry_date', label: 'Enquiry date', type: 'date' },
        { key: 'business_name', label: 'Business name', type: 'text' }, { key: 'business_type', label: 'Business type', type: 'select', options: CRM_CATEGORIES },
        { key: 'emirate', label: 'Emirate', type: 'select', options: EMIRATES }, { key: 'area', label: 'Area', type: 'text' },
        { key: 'asking_price', label: 'Asking price (AED)', type: 'money' }, { key: 'monthly_rent', label: 'Monthly rent (AED)', type: 'money' },
        { key: 'estimated_monthly_profit', label: 'Estimated monthly profit (AED, if provided)', type: 'money' }, { key: 'relationship', label: 'Seller is', type: 'select', options: SELLER_RELATIONSHIP },
        { key: 'verification_status', label: 'Owner / representative verification', type: 'select', options: SELLER_VERIFICATION, required: true },
        { key: 'source', label: 'Source', type: 'select', options: SOURCES, required: true }, { key: 'status', label: 'Status', type: 'select', options: SELLER_STATUSES, required: true },
        { key: 'assigned_to', label: 'Assigned staff', type: 'staff' }, { key: 'next_follow_up_date', label: 'Follow-up date', type: 'date' },
        { key: 'business_details', label: 'Business details', type: 'textarea', wide: true }, { key: 'internal_notes', label: 'Internal notes', type: 'textarea', wide: true },
    ],
    listing: [
        { key: 'seller_id', label: 'Seller', type: 'seller', required: true, wide: true }, { key: 'business_name', label: 'Business name', type: 'text', required: true },
        { key: 'category', label: 'Category', type: 'select', options: CRM_CATEGORIES, required: true }, { key: 'emirate', label: 'Emirate', type: 'select', options: EMIRATES, required: true },
        { key: 'area', label: 'Area', type: 'text' }, { key: 'asking_price', label: 'Asking price (AED)', type: 'money' }, { key: 'monthly_rent', label: 'Monthly rent (AED)', type: 'money' },
        { key: 'operating_costs', label: 'Operating costs (AED, if available)', type: 'money' }, { key: 'estimated_profit', label: 'Estimated profit (AED)', type: 'money' },
        { key: 'document_verification', label: 'Document verification', type: 'select', options: DOCUMENT_VERIFICATION, required: true },
        { key: 'authorization_status', label: 'Authorization to advertise', type: 'select', options: AUTHORIZATION, required: true },
        { key: 'status', label: 'Status', type: 'select', options: LISTING_STATUSES, required: true }, { key: 'availability', label: 'Availability', type: 'text' },
        { key: 'assigned_to', label: 'Assigned staff', type: 'staff' },
        { key: 'description', label: 'Description', type: 'textarea', wide: true }, { key: 'media_links', label: 'Photo / video links (one per line)', type: 'links', wide: true },
        { key: 'internal_notes', label: 'Internal notes', type: 'textarea', wide: true },
    ],
};
export const DEFAULTS: Record<EntityType, Record<string, string>> = {
    buyer: { source: 'Phone', status: 'New' },
    seller: { source: 'Phone', status: 'New', verification_status: 'Unverified' },
    listing: { status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' },
};
export const STATUS_OPTIONS: Record<EntityType, readonly string[]> = { buyer: BUYER_STATUSES, seller: SELLER_STATUSES, listing: LISTING_STATUSES };
export const LABELS: Record<EntityType, { plural: string; singular: string }> = { buyer: { plural: 'Buyers', singular: 'buyer' }, seller: { plural: 'Sellers', singular: 'seller' }, listing: { plural: 'Business listings', singular: 'listing' } };
export function aed(v: unknown) { return v == null || v === '' ? '—' : new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(v)); }
