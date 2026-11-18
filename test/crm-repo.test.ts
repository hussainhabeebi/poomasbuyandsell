import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.ts';
import { CrmError, createPublicEnquiry, createRecord, crmTotals, documentAccess, documentForDownload, getRecord, listRecords, listStaff, publicListings, recordDocument, resolveRole, safeFileName, updateRecord, upsertStaff, type Actor } from '../lib/crm/repo.ts';

const ADMINS = 'owner@poomas.test';
const admin: Actor = { email: 'owner@poomas.test', role: 'admin' };
const sales: Actor = { email: 'sales@poomas.test', role: 'sales' };
const readonly: Actor = { email: 'viewer@poomas.test', role: 'readonly' };
async function setup() {
    const db = TestD1.migrated();
    await upsertStaff(db, { email: sales.email, name: 'Sales One', role: 'sales', active: true }, admin, ADMINS);
    await upsertStaff(db, { email: readonly.email, name: 'Viewer', role: 'readonly', active: true }, admin, ADMINS);
    return db;
}
const buyer = (over: Record<string, unknown> = {}) => ({ name: 'Ahmed Buyer', phone: '050 111 2222', source: 'Phone', status: 'New', category: 'Cafeteria', emirate: 'Dubai', budget_min: 100000, budget_max: 250000, ...over });
const seller = (over: Record<string, unknown> = {}) => ({ contact_name: 'Sara Owner', phone: '+971 55 333 4444', email: 'sara@example.test', business_name: 'Sara Cafe', business_type: 'Cafeteria', emirate: 'Dubai', area: 'Deira', asking_price: 200000, estimated_monthly_profit: 15000, source: 'WhatsApp', status: 'New', verification_status: 'Unverified', internal_notes: 'Owner wants quick sale', ...over });
async function rejects(p: Promise<unknown>, status: number, message?: RegExp) {
    await assert.rejects(p, (e: unknown) => { assert.ok(e instanceof CrmError, String(e)); assert.equal(e.status, status, e.message); if (message) assert.match(e.message, message); return true; });
}

test('roles come from ADMIN_EMAILS or active crm_staff rows only', async () => {
    const db = await setup();
    assert.equal(await resolveRole(db, 'Owner@Poomas.test', ADMINS), 'admin');
    assert.equal(await resolveRole(db, sales.email, ADMINS), 'sales');
    assert.equal(await resolveRole(db, readonly.email, ADMINS), 'readonly');
    assert.equal(await resolveRole(db, 'stranger@example.test', ADMINS), null);
    await upsertStaff(db, { email: sales.email, name: 'Sales One', role: 'sales', active: false }, admin, ADMINS);
    assert.equal(await resolveRole(db, sales.email, ADMINS), null);
});

test('only administrators manage staff, and admins cannot lock themselves out', async () => {
    const db = await setup();
    await rejects(upsertStaff(db, { email: 'new@poomas.test', name: 'New', role: 'admin', active: true }, sales, ADMINS), 403);
    await rejects(upsertStaff(db, { email: admin.email, name: 'Owner', role: 'sales', active: true }, admin, ADMINS), 400, /own administrator/);
    await rejects(upsertStaff(db, { email: 'invalid', name: 'X', role: 'sales', active: true }, admin, ADMINS), 400);
    await rejects(upsertStaff(db, { email: 'x@poomas.test', name: 'X', role: 'superuser', active: true }, admin, ADMINS), 400);
    const staff = await listStaff(db, admin, ADMINS);
    assert.ok(staff.some(s => s.email === admin.email && (s as { fromAdminEmails?: boolean }).fromAdminEmails));
    const audit = db.sqlite.prepare("SELECT action FROM crm_audit WHERE entity_type='staff'").all();
    assert.equal(audit.length, 2);
});

test('records get sequential IDs per module', async () => {
    const db = await setup();
    const b1 = await createRecord(db, 'buyer', buyer(), sales, ADMINS);
    const b2 = await createRecord(db, 'buyer', buyer({ phone: '050 111 3333' }), sales, ADMINS);
    const s1 = await createRecord(db, 'seller', seller(), sales, ADMINS);
    const l1 = await createRecord(db, 'listing', { seller_id: s1.id, business_name: 'Sara Cafe', category: 'Cafeteria', emirate: 'Dubai', status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' }, sales, ADMINS);
    assert.deepEqual([b1.code, b2.code, s1.code, l1.code], ['BUY-0001', 'BUY-0002', 'SEL-0001', 'LST-0001']);
    const l2 = await createRecord(db, 'listing', { seller_id: s1.id, business_name: 'Sara Cafe 2', category: 'Cafeteria', emirate: 'Dubai', status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' }, admin, ADMINS);
    assert.equal(l2.code, 'LST-0002');
    const detail = await getRecord(db, 'seller', s1.id, admin);
    assert.equal((detail.listings as unknown[]).length, 2, 'one seller can have multiple listings');
});

test('validation rejects bad input', async () => {
    const db = await setup();
    await rejects(createRecord(db, 'buyer', buyer({ phone: 'not a phone' }), sales, ADMINS), 400, /phone/);
    await rejects(createRecord(db, 'buyer', buyer({ budget_min: 300000, budget_max: 100000 }), sales, ADMINS), 400, /Maximum budget/);
    await rejects(createRecord(db, 'buyer', buyer({ status: 'Paid' }), sales, ADMINS), 400);
    await rejects(createRecord(db, 'buyer', buyer({ emirate: 'Paris' }), sales, ADMINS), 400);
    await rejects(createRecord(db, 'buyer', buyer({ budget_min: -5 }), sales, ADMINS), 400);
    await rejects(createRecord(db, 'buyer', buyer({ assigned_to: 'stranger@example.test' }), sales, ADMINS), 400, /active staff/);
    await rejects(createRecord(db, 'buyer', buyer({ assigned_to: readonly.email }), sales, ADMINS), 400, /active staff/);
    await rejects(createRecord(db, 'listing', { seller_id: crypto.randomUUID(), business_name: 'X Shop', category: 'Gym', emirate: 'Dubai', status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' }, sales, ADMINS), 400, /seller/);
    const ok = await createRecord(db, 'buyer', buyer({ assigned_to: sales.email }), sales, ADMINS);
    assert.ok(ok.id);
});

test('duplicate phone numbers trigger a warning and are never merged automatically', async () => {
    const db = await setup();
    const first = await createRecord(db, 'buyer', buyer(), sales, ADMINS);
    await assert.rejects(createRecord(db, 'buyer', buyer({ name: 'Other', phone: '+971501112222' }), sales, ADMINS), (e: unknown) => {
        assert.ok(e instanceof CrmError);
        assert.equal(e.status, 409);
        const d = (e.details as { duplicates: { id: string; code: string; type: string }[] }).duplicates;
        assert.deepEqual(d.map(x => [x.type, x.code, x.id]), [['buyer', 'BUY-0001', first.id]]);
        return true;
    });
    assert.equal((await listRecords(db, 'buyer', {}, admin)).total, 1, 'nothing created without confirmation');
    const second = await createRecord(db, 'buyer', buyer({ name: 'Other', phone: '00971501112222' }), sales, ADMINS, { confirmDuplicate: true });
    assert.equal(second.duplicateOf, first.id);
    const both = await listRecords(db, 'buyer', {}, admin);
    assert.equal(both.total, 2);
    assert.equal(((await getRecord(db, "buyer", first.id, admin)).record as Record<string, unknown>).name, 'Ahmed Buyer', 'original untouched');
    assert.equal((await listRecords(db, 'buyer', { duplicates: '1' }, admin)).total, 1);
    // A seller with a buyer's number is also flagged.
    await rejects(createRecord(db, 'seller', seller({ phone: '0501112222' }), sales, ADMINS), 409);
    // Changing an existing record to a duplicate phone also warns.
    const s = await createRecord(db, 'seller', seller(), admin, ADMINS);
    await rejects(updateRecord(db, 'seller', s.id, { phone: '050 111 2222' }, admin, ADMINS), 409);
});

test('sales staff cannot see or overwrite seller contact, financial details or internal notes', async () => {
    const db = await setup();
    const s = await createRecord(db, 'seller', seller(), sales, ADMINS);
    const raw = db.sqlite.prepare('SELECT phone,email,estimated_monthly_profit,internal_notes FROM crm_sellers WHERE id=?').get(s.id) as Record<string, unknown>;
    assert.equal(raw.phone, '+971 55 333 4444', 'sales may record contact details at creation');
    assert.equal(raw.estimated_monthly_profit, 15000);
    assert.equal(raw.internal_notes, null, 'sales cannot write internal notes');
    const view = (await getRecord(db, 'seller', s.id, sales)).record as Record<string, unknown>;
    for (const k of ['phone', 'phone_normalized', 'email', 'estimated_monthly_profit', 'internal_notes'])
        assert.equal(k in view, false, k);
    const list = await listRecords(db, 'seller', {}, sales);
    assert.equal('phone' in list.records[0], false);
    const detail = await getRecord(db, 'seller', s.id, sales);
    assert.equal(detail.documents, undefined);
    assert.equal(detail.audit, undefined);
    await updateRecord(db, 'seller', s.id, { phone: '+971 55 999 9999', email: 'evil@example.test', estimated_monthly_profit: 1, internal_notes: 'x', status: 'Verification Pending' }, sales, ADMINS);
    const after = db.sqlite.prepare('SELECT phone,email,estimated_monthly_profit,internal_notes,status FROM crm_sellers WHERE id=?').get(s.id) as Record<string, unknown>;
    assert.deepEqual({ ...after }, { phone: '+971 55 333 4444', email: 'sara@example.test', estimated_monthly_profit: 15000, internal_notes: null, status: 'Verification Pending' });
    const adminView = (await getRecord(db, 'seller', s.id, admin)).record as Record<string, unknown>;
    assert.equal(adminView.phone, '+971 55 333 4444');
});

test('read-only users can browse normal fields but cannot write or see contacts', async () => {
    const db = await setup();
    const b = await createRecord(db, 'buyer', buyer(), admin, ADMINS);
    await rejects(createRecord(db, 'buyer', buyer({ phone: '0509999999' }), readonly, ADMINS), 403);
    await rejects(updateRecord(db, 'buyer', b.id, { status: 'Lost' }, readonly, ADMINS), 403);
    const r = (await getRecord(db, 'buyer', b.id, readonly)).record as Record<string, unknown>;
    assert.equal(r.name, 'Ahmed Buyer');
    assert.equal('phone' in r, false);
    await rejects(listRecords(db, 'buyer', {}, { email: 'x', role: 'nobody' as never }), 403);
});

test('only approved Active listings appear publicly', async () => {
    const db = await setup();
    const s = await createRecord(db, 'seller', seller(), admin, ADMINS);
    const listing = { seller_id: s.id, business_name: 'Sara Cafe', category: 'Cafeteria', emirate: 'Dubai', area: 'Deira', asking_price: 200000, operating_costs: 9000, estimated_profit: 12000, internal_notes: 'private', description: 'Busy cafe', status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' };
    const l = await createRecord(db, 'listing', listing, admin, ADMINS);
    assert.deepEqual(await publicListings(db), []);
    // Sales staff cannot approve.
    await rejects(updateRecord(db, 'listing', l.id, { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized' }, sales, ADMINS), 403, /administrator/);
    // Admin cannot approve until documents, authorization and seller are verified.
    await rejects(updateRecord(db, 'listing', l.id, { status: 'Active' }, admin, ADMINS), 400, /verified/);
    await rejects(updateRecord(db, 'listing', l.id, { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized' }, admin, ADMINS), 400, /seller is verified/);
    await updateRecord(db, 'seller', s.id, { verification_status: 'Owner verified' }, admin, ADMINS);
    await updateRecord(db, 'listing', l.id, { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized' }, admin, ADMINS);
    const pub = await publicListings(db);
    assert.equal(pub.length, 1);
    assert.equal(pub[0].code, 'LST-0001');
    for (const k of ['seller_id', 'operating_costs', 'estimated_profit', 'internal_notes', 'approved_by'])
        assert.equal(k in pub[0], false, k);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM crm_audit WHERE entity_id=? AND action='approve'").get(l.id)!.n, 1);
    // Sales cannot change public details of an Active listing.
    await rejects(updateRecord(db, 'listing', l.id, { description: 'Changed by sales' }, sales, ADMINS), 403, /public details/);
    // Reserved and Under Negotiation are not public.
    await updateRecord(db, 'listing', l.id, { status: 'Reserved' }, sales, ADMINS);
    assert.deepEqual(await publicListings(db), []);
    const row = db.sqlite.prepare('SELECT approved_at FROM crm_listings WHERE id=?').get(l.id) as { approved_at: unknown };
    assert.equal(row.approved_at, null, 'leaving Active clears approval');
    await updateRecord(db, 'listing', l.id, { status: 'Under Negotiation' }, sales, ADMINS);
    assert.deepEqual(await publicListings(db), []);
    // Returning to Active needs a fresh administrator approval.
    await rejects(updateRecord(db, 'listing', l.id, { status: 'Active' }, sales, ADMINS), 403);
    await updateRecord(db, 'listing', l.id, { status: 'Active' }, admin, ADMINS);
    assert.equal((await publicListings(db)).length, 1);
    // Withdrawing verification hides it even while marked Active.
    db.sqlite.prepare("UPDATE crm_listings SET document_verification='Rejected' WHERE id=?").run(l.id);
    assert.deepEqual(await publicListings(db), []);
    // Existing marketplace inventory is unaffected.
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM listings').get()!.n, 0);
});

test('website enquiries create records automatically without revealing duplicates', async () => {
    const db = await setup();
    await createPublicEnquiry(db, 'buyer', { name: 'Web Buyer', phone: '0507777777', category: 'Gym', emirate: 'Sharjah', requirements: 'Looking for a gym with equipment', contact_method: 'WhatsApp', consent: true });
    await createPublicEnquiry(db, 'seller', { contact_name: 'Web Seller', phone: '0508888888', business_name: 'Fit Gym', business_type: 'Gym', emirate: 'Ajman', relationship: 'Owner', business_details: 'Gym with 200 members', estimated_monthly_profit: 5000, consent: true });
    const buyers = await listRecords(db, 'buyer', {}, admin), sellers = await listRecords(db, 'seller', {}, admin);
    assert.equal(buyers.records[0].code, 'BUY-0001');
    assert.equal(buyers.records[0].source, 'Website');
    assert.equal(buyers.records[0].status, 'New');
    assert.equal(buyers.records[0].created_via, 'web');
    assert.ok(buyers.records[0].consent_at);
    assert.equal(sellers.records[0].code, 'SEL-0001');
    assert.equal(sellers.records[0].verification_status, 'Unverified');
    // A repeat submission is stored separately and flagged for staff.
    const again = await createPublicEnquiry(db, 'buyer', { name: 'Web Buyer', phone: '+971507777777', category: 'Gym', emirate: 'Sharjah', requirements: 'Still looking for a gym', contact_method: 'Phone', consent: true });
    assert.deepEqual(Object.keys(again), ['id']);
    const dup = await getRecord(db, 'buyer', again.id, admin);
    assert.equal((dup.duplicateOf as { code: string }).code, 'BUY-0001');
    // Consent is required, and staff-only fields cannot be injected.
    await rejects(createPublicEnquiry(db, 'buyer', { name: 'X Y', phone: '0501234567', category: 'Gym', emirate: 'Dubai', requirements: 'Need a gym please', contact_method: 'Phone', consent: false }), 400, /agree/);
    const injected = await createPublicEnquiry(db, 'buyer', { name: 'Inject', phone: '0501231231', category: 'Gym', emirate: 'Dubai', requirements: 'Need a gym please', contact_method: 'Phone', consent: true, status: 'Won', internal_notes: 'x', assigned_to: admin.email, source: 'Referral' });
    const row = db.sqlite.prepare('SELECT status,internal_notes,assigned_to,source FROM crm_buyers WHERE id=?').get(injected.id);
    assert.deepEqual({ ...row }, { status: 'New', internal_notes: null, assigned_to: null, source: 'Website' });
    // Audit trail never stores sensitive values.
    const audit = db.sqlite.prepare("SELECT changes FROM crm_audit WHERE entity_type='seller'").get() as { changes: string };
    assert.ok(!audit.changes.includes('0508888888') && !audit.changes.includes('5000'));
    assert.match(audit.changes, /\[redacted\]/);
});

test('search finds records by name, phone, ID, category, location, budget, source, status, staff and follow-up date', async () => {
    const db = await setup();
    await createRecord(db, 'buyer', buyer({ assigned_to: sales.email, next_follow_up_date: '2026-12-01' }), admin, ADMINS);
    await createRecord(db, 'buyer', buyer({ name: 'Fatima', phone: '0502223333', category: 'Gym', emirate: 'Sharjah', area: 'Al Nahda', budget_min: 500000, budget_max: 900000, source: 'Referral', status: 'Qualified' }), admin, ADMINS);
    const find = async (f: Record<string, string>) => (await listRecords(db, 'buyer', f, sales)).records.map(r => r.name);
    assert.deepEqual(await find({ q: 'fatima' }), ['Fatima']);
    assert.deepEqual(await find({ q: '+971 50 222 3333' }), ['Fatima']);
    assert.deepEqual(await find({ q: 'BUY-0001' }), ['Ahmed Buyer']);
    assert.deepEqual(await find({ category: 'Gym' }), ['Fatima']);
    assert.deepEqual(await find({ emirate: 'Dubai' }), ['Ahmed Buyer']);
    assert.deepEqual(await find({ area: 'nahda' }), ['Fatima']);
    assert.deepEqual(await find({ min: '400000' }), ['Fatima']);
    assert.deepEqual(await find({ max: '200000' }), ['Ahmed Buyer']);
    assert.deepEqual(await find({ source: 'Referral' }), ['Fatima']);
    assert.deepEqual(await find({ status: 'Qualified' }), ['Fatima']);
    assert.deepEqual(await find({ assigned_to: sales.email }), ['Ahmed Buyer']);
    assert.deepEqual(await find({ follow_up_from: '2026-11-30', follow_up_to: '2026-12-02' }), ['Ahmed Buyer']);
    assert.deepEqual(await find({ q: "' OR 1=1 --" }), []);
    const s = await createRecord(db, 'seller', seller(), admin, ADMINS);
    await createRecord(db, 'listing', { seller_id: s.id, business_name: 'Deira Cafe', category: 'Cafeteria', emirate: 'Dubai', asking_price: 200000, status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' }, admin, ADMINS);
    const listings = await listRecords(db, 'listing', { category: 'Cafeteria', emirate: 'Dubai', min: '100000', max: '300000', status: 'Draft' }, sales);
    assert.equal(listings.total, 1);
    assert.equal(listings.records[0].seller_code, 'SEL-0001');
    assert.equal((await listRecords(db, 'seller', { q: '055 333 4444' }, sales)).total, 1, 'sales can find a seller by phone without seeing it');
    const totals = await crmTotals(db, readonly);
    assert.deepEqual({ ...totals }, { buyers: 2, sellers: 1, activeListings: 0, newEnquiries: 2, possibleDuplicates: 0 });
});

test('confidential documents are administrator-only and downloads are audited', async () => {
    const db = await setup();
    const s = await createRecord(db, 'seller', seller(), admin, ADMINS);
    await rejects(documentAccess(db, sales, 'seller', s.id), 403);
    await rejects(documentAccess(db, readonly, 'seller', s.id), 403);
    await rejects(documentAccess(db, admin, 'buyer', s.id), 400);
    await rejects(documentAccess(db, admin, 'seller', crypto.randomUUID()), 404);
    assert.equal(await documentAccess(db, admin, 'seller', s.id), 'seller');
    const id = crypto.randomUUID();
    await recordDocument(db, admin, { id, entityType: 'seller', entityId: s.id, fileName: safeFileName('../../trade "licence".pdf'), contentType: 'application/pdf', size: 1000 });
    await rejects(documentForDownload(db, sales, id), 404);
    const doc = await documentForDownload(db, admin, id);
    assert.equal(doc.file_name, '_.._trade _licence_.pdf');
    const actions = db.sqlite.prepare('SELECT action FROM crm_audit WHERE entity_id=? ORDER BY created_at').all(s.id).map(r => r.action);
    assert.deepEqual(actions, ['create', 'upload_document', 'view_document']);
    assert.equal(((await getRecord(db, 'seller', s.id, admin)).documents as unknown[]).length, 1);
});

test('audit history records who changed what', async () => {
    const db = await setup();
    const b = await createRecord(db, 'buyer', buyer(), sales, ADMINS);
    const unchanged = await updateRecord(db, 'buyer', b.id, { status: 'New' }, sales, ADMINS);
    assert.equal(unchanged.changed, false);
    await updateRecord(db, 'buyer', b.id, { status: 'Contacted', last_contact_date: '2026-11-18' }, sales, ADMINS);
    const detail = await getRecord(db, 'buyer', b.id, admin);
    const audit = detail.audit as { action: string; actor_email: string; changes: Record<string, { from: unknown; to: unknown }> }[];
    assert.equal(audit.length, 2);
    assert.equal(audit[0].action, 'update');
    assert.equal(audit[0].actor_email, sales.email);
    assert.deepEqual(audit[0].changes.status, { from: 'New', to: 'Contacted' });
    await rejects(updateRecord(db, 'buyer', crypto.randomUUID(), { status: 'Lost' }, sales, ADMINS), 404);
});
