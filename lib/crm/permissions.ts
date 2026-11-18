// Role-based access for the CRM. Server routes call these on every request;
// the browser only receives data that has already been redacted here.
import type { Role } from './constants.ts';
export type EntityType = 'buyer' | 'seller' | 'listing';
// Sensitive field classes. Sales staff can work with all normal records (and
// buyer contact details, which they need to follow up) but never receive seller
// contact, financial, document or internal-note data. Read-only users receive
// normal fields only.
export type Sensitivity = 'buyerContact' | 'sellerContact' | 'financial' | 'documents' | 'internalNotes';
export const SENSITIVE_FIELDS: Record<EntityType, Partial<Record<string, Sensitivity>>> = {
    buyer: { phone: 'buyerContact', phone_normalized: 'buyerContact', email: 'buyerContact', internal_notes: 'internalNotes' },
    seller: { phone: 'sellerContact', phone_normalized: 'sellerContact', email: 'sellerContact', estimated_monthly_profit: 'financial', internal_notes: 'internalNotes' },
    listing: { operating_costs: 'financial', estimated_profit: 'financial', internal_notes: 'internalNotes' },
};
const SENSITIVE_ACCESS: Record<Role, Sensitivity[]> = {
    admin: ['buyerContact', 'sellerContact', 'financial', 'documents', 'internalNotes'],
    sales: ['buyerContact'],
    readonly: [],
};
export type Capability = 'read' | 'write' | 'approveListing' | 'manageStaff' | 'viewAudit';
const CAPABILITIES: Record<Role, Capability[]> = {
    admin: ['read', 'write', 'approveListing', 'manageStaff', 'viewAudit'],
    sales: ['read', 'write'],
    readonly: ['read'],
};
export function can(role: Role | null | undefined, capability: Capability) { return !!role && CAPABILITIES[role]?.includes(capability); }
export function canSee(role: Role | null | undefined, sensitivity: Sensitivity) { return !!role && SENSITIVE_ACCESS[role]?.includes(sensitivity); }
export function restrictedFields(entity: EntityType, role: Role | null | undefined): string[] {
    return Object.entries(SENSITIVE_FIELDS[entity]).filter(([, s]) => !canSee(role, s!)).map(([f]) => f);
}
// Removes every field the role may not read and lists what was withheld.
export function redact<T extends Record<string, unknown>>(entity: EntityType, row: T, role: Role | null | undefined): T & { restricted: string[] } {
    const hidden = restrictedFields(entity, role);
    const out: Record<string, unknown> = { ...row };
    for (const f of hidden)
        delete out[f];
    return { ...(out as T), restricted: hidden.filter(f => f !== 'phone_normalized') };
}
// Fields a role may write. Users cannot change a sensitive field they cannot
// read, except that a new record's seller contact and financial details may be
// entered once at creation (for example, from a phone enquiry).
export function writableFields(entity: EntityType, role: Role, fields: string[], creating: boolean): string[] {
    if (!can(role, 'write'))
        return [];
    const hidden = new Set(restrictedFields(entity, role));
    const createOnce = (f: string) => creating && ['sellerContact', 'financial'].includes(SENSITIVE_FIELDS[entity][f] ?? '');
    return fields.filter(f => !hidden.has(f) || createOnce(f));
}
