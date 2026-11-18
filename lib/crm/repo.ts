// CRM data access. Works against any D1-compatible database so it can be tested
// under Node with SQLite. Every function enforces permissions itself.
import { ENTITIES } from './entities.ts';
import { can, canSee, redact, writableFields, type EntityType } from './permissions.ts';
import type { Role } from './constants.ts';
import { normalizePhone } from './phone.ts';
import { buildSearch, type SearchFilters } from './search.ts';
import { auditChanges } from './audit.ts';
import { PUBLIC_LISTING_FIELDS, PUBLIC_LISTING_SQL, publicCrmListing, safeJsonArray } from './visibility.ts';
import { SCHEMAS, firstIssue, publicBuyerInput, publicSellerInput, staffInput } from './validation.ts';
export interface Stmt { bind(...values: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
export interface DB { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown[]> }
export type Actor = { email: string; role: Role };
export class CrmError extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status = 400, details?: unknown) { super(message); this.status = status; this.details = details; }
}
type Row = Record<string, unknown>;
export const PAGE_SIZE = 50;
export function dubaiDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
const emailList = (adminEmails: string) => adminEmails.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
// ADMIN_EMAILS remain administrators; other staff need an active crm_staff row.
export async function resolveRole(db: DB, email: string, adminEmails: string): Promise<Role | null> {
    const e = email.trim().toLowerCase();
    if (emailList(adminEmails).includes(e))
        return 'admin';
    const row = await db.prepare('SELECT role FROM crm_staff WHERE email=? AND active=1').bind(e).first<{ role: Role }>();
    return row && ['admin', 'sales', 'readonly'].includes(row.role) ? row.role : null;
}
function audit(db: DB, actor: string, entity: string, id: string, action: string, changes: unknown, now: string) {
    return db.prepare('INSERT INTO crm_audit (id,actor_email,entity_type,entity_id,action,changes,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), actor, entity, id, action, JSON.stringify(changes ?? {}), now);
}
export async function findDuplicates(db: DB, phone: string, exclude?: { type: EntityType; id: string }) {
    const normalized = normalizePhone(phone);
    if (!normalized)
        return [];
    const buyers = await db.prepare('SELECT id,code,name FROM crm_buyers WHERE phone_normalized=? ORDER BY created_at LIMIT 10').bind(normalized).all<Row>();
    const sellers = await db.prepare('SELECT id,code,contact_name AS name FROM crm_sellers WHERE phone_normalized=? ORDER BY created_at LIMIT 10').bind(normalized).all<Row>();
    type Duplicate = { type: EntityType; id: string; code: string; name: string };
    const all = [...buyers.results.map(r => ({ ...r, type: 'buyer' })), ...sellers.results.map(r => ({ ...r, type: 'seller' }))] as Duplicate[];
    return all.filter(r => !(exclude && r.type === exclude.type && r.id === exclude.id));
}
async function assertAssignee(db: DB, email: unknown, adminEmails: string) {
    if (email == null)
        return;
    const e = String(email).toLowerCase();
    if (emailList(adminEmails).includes(e))
        return;
    const row = await db.prepare("SELECT email FROM crm_staff WHERE email=? AND active=1 AND role IN ('admin','sales')").bind(e).first();
    if (!row)
        throw new CrmError('Assign the record to an active staff member.');
}
const SELLER_VERIFIED = ['Owner verified', 'Authorized representative verified'];
// Enforces the listing approval rules. Returns approval columns to store.
async function listingApproval(db: DB, actor: Actor, before: Row | null, next: Row, now: string): Promise<Row> {
    const seller = await db.prepare('SELECT id,verification_status FROM crm_sellers WHERE id=?').bind(next.seller_id).first<{ verification_status: string }>();
    if (!seller)
        throw new CrmError('Choose the seller this listing belongs to.');
    const wasActive = before?.status === 'Active';
    if (next.status === 'Active') {
        const approvalChanged = !wasActive || ['document_verification', 'authorization_status', 'seller_id'].some(k => before?.[k] !== next[k]);
        const publicChanged = wasActive && PUBLIC_LISTING_FIELDS.some(k => k !== 'code' && JSON.stringify(before?.[k] ?? null) !== JSON.stringify(next[k] ?? null));
        if ((approvalChanged || publicChanged) && !can(actor.role, 'approveListing'))
            throw new CrmError(wasActive ? 'Only an administrator can change the public details of an Active listing.' : 'Only an administrator can approve a listing as Active.', 403);
        if (next.document_verification !== 'Verified' || next.authorization_status !== 'Authorized' || !SELLER_VERIFIED.includes(seller.verification_status))
            throw new CrmError('A listing can be Active only when documents are verified, publishing is authorized and the seller is verified as owner or authorized representative.');
        return wasActive && !approvalChanged && !publicChanged ? {} : { approved_by: actor.email, approved_at: now };
    }
    return { approved_by: null, approved_at: null };
}
function prepareValues(type: EntityType, data: Row) {
    const out: Row = { ...data };
    if (type === 'listing' && 'media_links' in out)
        out.media_links = JSON.stringify(out.media_links ?? []);
    if ('phone' in out && typeof out.phone === 'string')
        out.phone_normalized = normalizePhone(out.phone);
    return out;
}
export async function createRecord(db: DB, type: EntityType, input: unknown, actor: Actor, adminEmails: string, opts: { confirmDuplicate?: boolean } = {}) {
    if (!can(actor.role, 'write'))
        throw new CrmError('Your role cannot create records.', 403);
    const def = ENTITIES[type], parsed = SCHEMAS[type].create.safeParse(input);
    if (!parsed.success)
        throw new CrmError(firstIssue(parsed.error));
    const allowed = new Set(writableFields(type, actor.role, def.fields, true));
    const data: Row = {};
    for (const [k, v] of Object.entries(parsed.data as Row))
        if (allowed.has(k))
            data[k] = v;
    await assertAssignee(db, data.assigned_to, adminEmails);
    const now = new Date().toISOString(), id = crypto.randomUUID();
    let duplicateOf: string | null = null;
    if (def.hasPhone) {
        const duplicates = await findDuplicates(db, String(data.phone));
        const sameType = duplicates.filter(d => d.type === type);
        if (duplicates.length && !opts.confirmDuplicate)
            throw new CrmError('This phone number already exists in the CRM. Review the existing record before creating another.', 409, { duplicates });
        duplicateOf = sameType[0]?.id ?? null;
    }
    const values: Row = prepareValues(type, data);
    if (type === 'listing')
        Object.assign(values, await listingApproval(db, actor, null, values, now));
    else
        Object.assign(values, { enquiry_date: values.enquiry_date ?? dubaiDate(), duplicate_of: duplicateOf, created_via: 'staff' });
    Object.assign(values, { created_by: actor.email, created_at: now, updated_at: now });
    await insertWithCode(db, type, id, values, [audit(db, actor.email, type, id, 'create', auditChanges(type, null, values), now)]);
    const row = await db.prepare(`SELECT code FROM ${def.table} WHERE id=?`).bind(id).first<{ code: string }>();
    return { id, code: row?.code ?? '', duplicateOf };
}
async function insertWithCode(db: DB, type: EntityType, id: string, values: Row, extra: Stmt[]) {
    const def = ENTITIES[type], cols = Object.keys(values);
    await db.batch([
        db.prepare('INSERT OR IGNORE INTO crm_counters (name,value) VALUES (?,0)').bind(def.counter),
        db.prepare('UPDATE crm_counters SET value=value+1 WHERE name=?').bind(def.counter),
        db.prepare(`INSERT INTO ${def.table} (id,code,${cols.join(',')}) VALUES (?,(SELECT printf('${def.prefix}-%04d',value) FROM crm_counters WHERE name=?),${cols.map(() => '?').join(',')})`).bind(id, def.counter, ...cols.map(c => values[c] ?? null)),
        ...extra,
    ]);
}
export async function updateRecord(db: DB, type: EntityType, id: string, input: unknown, actor: Actor, adminEmails: string, opts: { confirmDuplicate?: boolean } = {}) {
    if (!can(actor.role, 'write'))
        throw new CrmError('Your role cannot change records.', 403);
    const def = ENTITIES[type];
    const before = await db.prepare(`SELECT * FROM ${def.table} WHERE id=?`).bind(id).first<Row>();
    if (!before)
        throw new CrmError('Record not found.', 404);
    const parsed = SCHEMAS[type].update.safeParse(input);
    if (!parsed.success)
        throw new CrmError(firstIssue(parsed.error));
    const allowed = new Set(writableFields(type, actor.role, def.fields, false));
    const patch: Row = {};
    for (const [k, v] of Object.entries(parsed.data as Row))
        if (allowed.has(k) && v !== undefined)
            patch[k] = v;
    if (type === 'buyer') {
        const min = 'budget_min' in patch ? patch.budget_min : before.budget_min, max = 'budget_max' in patch ? patch.budget_max : before.budget_max;
        if (min != null && max != null && Number(min) > Number(max))
            throw new CrmError('Maximum budget must be at least the minimum budget.');
    }
    if ('assigned_to' in patch && patch.assigned_to !== before.assigned_to)
        await assertAssignee(db, patch.assigned_to, adminEmails);
    const values = prepareValues(type, patch);
    if (def.hasPhone && values.phone_normalized && values.phone_normalized !== before.phone_normalized) {
        const duplicates = await findDuplicates(db, String(values.phone), { type, id });
        if (duplicates.length && !opts.confirmDuplicate)
            throw new CrmError('This phone number already exists in the CRM. Review the existing record first.', 409, { duplicates });
    }
    const now = new Date().toISOString();
    if (type === 'listing')
        Object.assign(values, await listingApproval(db, actor, before, { ...before, ...values }, now));
    const changes = auditChanges(type, before, values);
    if (!Object.keys(changes).length)
        return { id, code: String(before.code), changed: false };
    values.updated_at = now;
    const cols = Object.keys(values);
    const action = type === 'listing' && values.approved_at && values.approved_at === now ? 'approve' : 'update';
    await db.batch([
        db.prepare(`UPDATE ${def.table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).bind(...cols.map(c => values[c] ?? null), id),
        audit(db, actor.email, type, id, action, changes, now),
    ]);
    return { id, code: String(before.code), changed: true };
}
function decode(type: EntityType, row: Row) { return type === 'listing' ? { ...row, media_links: safeJsonArray(row.media_links) } : row; }
export async function listRecords(db: DB, type: EntityType, filters: SearchFilters, actor: Actor, page = 0) {
    if (!can(actor.role, 'read'))
        throw new CrmError('CRM access required.', 403);
    const def = ENTITIES[type], listing = type === 'listing', { where, binds } = buildSearch(type, filters, 'r');
    const offset = Math.max(0, Math.min(1000, Math.floor(page) || 0)) * PAGE_SIZE;
    const select = listing ? 'SELECT r.*,s.code AS seller_code,s.contact_name AS seller_name FROM crm_listings r LEFT JOIN crm_sellers s ON s.id=r.seller_id' : `SELECT r.* FROM ${def.table} r`;
    const rows = await db.prepare(`${select} ${where} ORDER BY r.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`).bind(...binds).all<Row>();
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM ${def.table} r ${where}`).bind(...binds).first<{ n: number }>();
    return { records: rows.results.slice(0, PAGE_SIZE).map(r => redact(type, decode(type, r), actor.role)), more: rows.results.length > PAGE_SIZE, total: Number(total?.n ?? 0) };
}
export async function getRecord(db: DB, type: EntityType, id: string, actor: Actor) {
    if (!can(actor.role, 'read'))
        throw new CrmError('CRM access required.', 403);
    const def = ENTITIES[type];
    const row = await db.prepare(`SELECT * FROM ${def.table} WHERE id=?`).bind(id).first<Row>();
    if (!row)
        throw new CrmError('Record not found.', 404);
    const result: Row = { record: redact(type, decode(type, row), actor.role) };
    if (type === 'listing')
        result.seller = await db.prepare('SELECT id,code,contact_name,business_name,verification_status FROM crm_sellers WHERE id=?').bind(row.seller_id).first();
    if (type === 'seller')
        result.listings = (await db.prepare('SELECT id,code,business_name,status FROM crm_listings WHERE seller_id=? ORDER BY created_at').bind(id).all()).results;
    if (row.duplicate_of)
        result.duplicateOf = await db.prepare(`SELECT id,code FROM ${def.table} WHERE id=?`).bind(row.duplicate_of).first();
    if (def.hasPhone && row.phone_normalized) {
        const others = await findDuplicates(db, String(row.phone_normalized), { type, id });
        result.duplicates = others;
    }
    if (type !== 'buyer' && canSee(actor.role, 'documents'))
        result.documents = (await db.prepare('SELECT id,file_name,content_type,size,uploaded_by,created_at FROM crm_documents WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC').bind(type, id).all()).results;
    if (can(actor.role, 'viewAudit'))
        result.audit = (await db.prepare('SELECT actor_email,action,changes,created_at FROM crm_audit WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 50').bind(type, id).all<Row>()).results.map(a => ({ ...a, changes: JSON.parse(String(a.changes || '{}')) }));
    return result;
}
// Public website enquiries. Duplicates are linked for staff review, never merged,
// and the response never reveals whether a phone number already exists.
export async function createPublicEnquiry(db: DB, kind: 'buyer' | 'seller', input: unknown) {
    const parsed = (kind === 'buyer' ? publicBuyerInput : publicSellerInput).safeParse(input);
    if (!parsed.success)
        throw new CrmError(firstIssue(parsed.error));
    const { consent, ...data } = parsed.data as Row & { consent: true };
    void consent;
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const duplicates = (await findDuplicates(db, String(data.phone))).filter(d => d.type === kind);
    const values: Row = { ...prepareValues(kind, data), enquiry_date: dubaiDate(), source: 'Website', status: 'New', consent_at: now, duplicate_of: duplicates[0]?.id ?? null, created_via: 'web', created_by: null, created_at: now, updated_at: now };
    if (kind === 'seller')
        values.verification_status = 'Unverified';
    await insertWithCode(db, kind, id, values, [audit(db, 'website', kind, id, 'create', auditChanges(kind, null, values), now)]);
    return { id };
}
export async function publicListings(db: DB) {
    const rows = await db.prepare(`SELECT ${PUBLIC_LISTING_FIELDS.join(',')} FROM crm_listings WHERE ${PUBLIC_LISTING_SQL} ORDER BY approved_at DESC LIMIT 200`).all<Row>();
    return rows.results.map(publicCrmListing);
}
export async function crmTotals(db: DB, actor: Actor) {
    if (!can(actor.role, 'read'))
        throw new CrmError('CRM access required.', 403);
    const row = await db.prepare("SELECT (SELECT COUNT(*) FROM crm_buyers) AS buyers,(SELECT COUNT(*) FROM crm_sellers) AS sellers,(SELECT COUNT(*) FROM crm_listings WHERE status='Active') AS activeListings,(SELECT COUNT(*) FROM crm_buyers WHERE status='New')+(SELECT COUNT(*) FROM crm_sellers WHERE status='New') AS newEnquiries,(SELECT COUNT(*) FROM crm_buyers WHERE duplicate_of IS NOT NULL)+(SELECT COUNT(*) FROM crm_sellers WHERE duplicate_of IS NOT NULL) AS possibleDuplicates").first<Row>();
    return row ?? {};
}
export async function listStaff(db: DB, actor: Actor, adminEmails: string) {
    if (!can(actor.role, 'read'))
        throw new CrmError('CRM access required.', 403);
    const rows = (await db.prepare('SELECT email,name,role,active,created_at,updated_at FROM crm_staff ORDER BY active DESC, name').all<Row>()).results;
    const listed = new Set(rows.map(r => r.email));
    const bootstrap = emailList(adminEmails).filter(e => !listed.has(e)).map(email => ({ email, name: email, role: 'admin', active: 1, fromAdminEmails: true }));
    return can(actor.role, 'manageStaff') ? [...bootstrap, ...rows] : rows.filter(r => r.active).map(r => ({ email: r.email, name: r.name, role: r.role, active: r.active })).concat(bootstrap);
}
export async function upsertStaff(db: DB, input: unknown, actor: Actor, adminEmails: string) {
    if (!can(actor.role, 'manageStaff'))
        throw new CrmError('Only an administrator can manage the team.', 403);
    const parsed = staffInput.safeParse(input);
    if (!parsed.success)
        throw new CrmError(firstIssue(parsed.error));
    const s = parsed.data;
    if (s.email === actor.email.toLowerCase() && (s.role !== 'admin' || !s.active))
        throw new CrmError('You cannot remove your own administrator access.');
    if (emailList(adminEmails).includes(s.email) && (s.role !== 'admin' || !s.active))
        throw new CrmError('This person is an administrator through ADMIN_EMAILS. Remove them there first.');
    const now = new Date().toISOString();
    const before = await db.prepare('SELECT name,role,active FROM crm_staff WHERE email=?').bind(s.email).first<Row>();
    await db.batch([
        db.prepare('INSERT INTO crm_staff (email,name,role,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active,updated_at=excluded.updated_at').bind(s.email, s.name, s.role, s.active ? 1 : 0, actor.email, now, now),
        audit(db, actor.email, 'staff', s.email, before ? 'update' : 'create', { name: { from: before?.name ?? null, to: s.name }, role: { from: before?.role ?? null, to: s.role }, active: { from: before?.active ?? null, to: s.active ? 1 : 0 } }, now),
    ]);
    return { ok: true };
}
export const DOCUMENT_TYPES: Record<string, (b: Uint8Array) => boolean> = {
    'application/pdf': b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8,
    'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
};
export const DOCUMENT_MAX_BYTES = 10_000_000;
export function documentKey(id: string) { return `crm-documents/${id}`; }
export function safeFileName(name: string) { return (name.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').trim() || 'document').slice(0, 120); }
export async function documentAccess(db: DB, actor: Actor, entityType: unknown, entityId: unknown) {
    if (!canSee(actor.role, 'documents'))
        throw new CrmError('Only an administrator can access confidential documents.', 403);
    if (entityType !== 'seller' && entityType !== 'listing')
        throw new CrmError('Documents can be attached to sellers or listings.');
    const row = await db.prepare(`SELECT id FROM ${ENTITIES[entityType].table} WHERE id=?`).bind(String(entityId)).first();
    if (!row)
        throw new CrmError('Record not found.', 404);
    return entityType;
}
export async function recordDocument(db: DB, actor: Actor, doc: { id: string; entityType: 'seller' | 'listing'; entityId: string; fileName: string; contentType: string; size: number }) {
    const now = new Date().toISOString();
    await db.batch([
        db.prepare('INSERT INTO crm_documents (id,entity_type,entity_id,file_name,content_type,size,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(doc.id, doc.entityType, doc.entityId, doc.fileName, doc.contentType, doc.size, actor.email, now),
        audit(db, actor.email, doc.entityType, doc.entityId, 'upload_document', { document: { from: null, to: doc.fileName } }, now),
    ]);
}
export async function documentForDownload(db: DB, actor: Actor, id: string) {
    if (!canSee(actor.role, 'documents'))
        throw new CrmError('Not found.', 404);
    const row = await db.prepare('SELECT * FROM crm_documents WHERE id=?').bind(id).first<{ id: string; entity_type: string; entity_id: string; file_name: string; content_type: string }>();
    if (!row)
        throw new CrmError('Not found.', 404);
    await audit(db, actor.email, row.entity_type, row.entity_id, 'view_document', { document: { from: null, to: row.file_name } }, new Date().toISOString()).run();
    return row;
}
