// A CRM business listing is public only when an administrator has approved it
// as Active and both document verification and authorisation are complete.
// Reserved / Under Negotiation / Sold listings are never automatically public.
export const PUBLIC_LISTING_SQL = "status='Active' AND document_verification='Verified' AND authorization_status='Authorized' AND approved_at IS NOT NULL";
export function isPublicListing(l: { status?: unknown; document_verification?: unknown; authorization_status?: unknown; approved_at?: unknown }) {
    return l.status === 'Active' && l.document_verification === 'Verified' && l.authorization_status === 'Authorized' && !!l.approved_at;
}
// Fields that may be shown to the public for an approved listing.
export const PUBLIC_LISTING_FIELDS = ['code', 'business_name', 'category', 'emirate', 'area', 'asking_price', 'monthly_rent', 'description', 'media_links', 'availability'] as const;
export function publicCrmListing(row: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const f of PUBLIC_LISTING_FIELDS)
        out[f] = f === 'media_links' ? safeJsonArray(row[f]) : row[f] ?? null;
    return out;
}
export function safeJsonArray(v: unknown): string[] { try {
    const a = JSON.parse(String(v ?? '[]'));
    return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
}
catch {
    return [];
} }
