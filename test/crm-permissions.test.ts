import test from 'node:test';
import assert from 'node:assert/strict';
import { can, canSee, redact, restrictedFields, writableFields } from '../lib/crm/permissions.ts';
import { ENTITIES } from '../lib/crm/entities.ts';
import { isPublicListing, publicCrmListing } from '../lib/crm/visibility.ts';
const seller = { id: 's', code: 'SEL-0001', contact_name: 'Owner', phone: '+971501234567', phone_normalized: '+971501234567', email: 'o@example.test', asking_price: 500000, estimated_monthly_profit: 20000, internal_notes: 'secret note', status: 'New' };
test('administrators see everything', () => {
    const r = redact('seller', seller, 'admin');
    assert.equal(r.phone, seller.phone);
    assert.equal(r.estimated_monthly_profit, 20000);
    assert.equal(r.internal_notes, 'secret note');
    assert.deepEqual(r.restricted, []);
});
test('sales staff see normal seller fields but not contact, financial or notes', () => {
    const r = redact('seller', seller, 'sales');
    for (const k of ['phone', 'phone_normalized', 'email', 'estimated_monthly_profit', 'internal_notes'])
        assert.equal(k in r, false, k);
    assert.equal(r.contact_name, 'Owner');
    assert.equal(r.asking_price, 500000);
    assert.deepEqual(new Set(r.restricted), new Set(['phone', 'email', 'estimated_monthly_profit', 'internal_notes']));
    assert.equal(canSee('sales', 'documents'), false);
});
test('sales staff can see buyer contact details; read-only users cannot', () => {
    const buyer = { id: 'b', name: 'Buyer', phone: '+971501111111', email: 'b@example.test', internal_notes: 'n' };
    assert.equal(redact('buyer', buyer, 'sales').phone, buyer.phone);
    assert.equal('internal_notes' in redact('buyer', buyer, 'sales'), false);
    const ro = redact('buyer', buyer, 'readonly');
    assert.equal('phone' in ro, false);
    assert.equal('email' in ro, false);
});
test('listing financial fields are restricted to administrators', () => {
    const listing = { id: 'l', business_name: 'Cafe', asking_price: 1, monthly_rent: 2, operating_costs: 3, estimated_profit: 4, internal_notes: 'x' };
    const r = redact('listing', listing, 'sales');
    assert.equal(r.asking_price, 1);
    assert.equal(r.monthly_rent, 2);
    assert.equal('operating_costs' in r, false);
    assert.equal('estimated_profit' in r, false);
    assert.equal('internal_notes' in r, false);
});
test('capabilities by role', () => {
    assert.equal(can('admin', 'manageStaff'), true);
    assert.equal(can('sales', 'write'), true);
    assert.equal(can('sales', 'approveListing'), false);
    assert.equal(can('sales', 'manageStaff'), false);
    assert.equal(can('readonly', 'read'), true);
    assert.equal(can('readonly', 'write'), false);
    assert.equal(can(null, 'read'), false);
    assert.equal(redact('seller', seller, null).restricted.length > 0, true);
});
test('sales can enter seller contact/financials at creation only; read-only can write nothing', () => {
    const fields = ENTITIES.seller.fields;
    const create = writableFields('seller', 'sales', fields, true), update = writableFields('seller', 'sales', fields, false);
    assert.ok(create.includes('phone') && create.includes('estimated_monthly_profit'));
    assert.ok(!create.includes('internal_notes'));
    assert.ok(!update.includes('phone') && !update.includes('email') && !update.includes('estimated_monthly_profit'));
    assert.ok(update.includes('status') && update.includes('asking_price'));
    assert.deepEqual(writableFields('seller', 'readonly', fields, true), []);
    assert.deepEqual(restrictedFields('seller', 'admin'), []);
});
test('only approved Active listings are public, with a safe projection', () => {
    const base = { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized', approved_at: '2026-01-01' };
    assert.equal(isPublicListing(base), true);
    for (const patch of [{ status: 'Reserved' }, { status: 'Under Negotiation' }, { status: 'Draft' }, { status: 'Sold' }, { document_verification: 'Pending' }, { authorization_status: 'Rejected' }, { approved_at: null }])
        assert.equal(isPublicListing({ ...base, ...patch }), false, JSON.stringify(patch));
    const p = publicCrmListing({ ...base, code: 'LST-0001', business_name: 'Cafe', seller_id: 's', operating_costs: 9, estimated_profit: 8, internal_notes: 'n', media_links: '["https://x.test/a.jpg"]' });
    for (const k of ['seller_id', 'operating_costs', 'estimated_profit', 'internal_notes', 'status', 'approved_at'])
        assert.equal(k in p, false, k);
    assert.deepEqual(p.media_links, ['https://x.test/a.jpg']);
});
