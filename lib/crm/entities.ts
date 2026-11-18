import type { EntityType } from './permissions.ts';
import { buyerFields, listingFields, sellerFields } from './validation.ts';
export type EntityDef = { type: EntityType; table: string; prefix: string; counter: string; fields: string[]; nameColumns: string[]; priceRange: 'budget' | 'asking_price'; categoryColumn: string; hasPhone: boolean };
export const ENTITIES: Record<EntityType, EntityDef> = {
    buyer: { type: 'buyer', table: 'crm_buyers', prefix: 'BUY', counter: 'buyer', fields: Object.keys(buyerFields), nameColumns: ['name'], priceRange: 'budget', categoryColumn: 'category', hasPhone: true },
    seller: { type: 'seller', table: 'crm_sellers', prefix: 'SEL', counter: 'seller', fields: Object.keys(sellerFields), nameColumns: ['contact_name', 'business_name'], priceRange: 'asking_price', categoryColumn: 'business_type', hasPhone: true },
    listing: { type: 'listing', table: 'crm_listings', prefix: 'LST', counter: 'listing', fields: Object.keys(listingFields), nameColumns: ['business_name'], priceRange: 'asking_price', categoryColumn: 'category', hasPhone: false },
};
export function isEntityType(v: unknown): v is EntityType { return v === 'buyer' || v === 'seller' || v === 'listing'; }
