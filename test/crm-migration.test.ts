import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestD1 } from './helpers/d1.ts';
const CRM = '0002_crm_phase1.sql';
const sql = readFileSync(new URL('../drizzle/' + CRM, import.meta.url), 'utf8');
const EXISTING = ['listings', 'saved', 'enquiries', 'promotions', 'media', 'webhook_events', 'rate_limits', 'nomod_attempts', 'nomod_events', 'nomod_payments', 'nomod_audit'];
test('CRM migration is additive: no ALTER, DROP, UPDATE or DELETE, and touches only crm_ tables', () => {
    const code = sql.replace(/--.*$/gm, '').replace(/ON UPDATE no action ON DELETE no action/g, '');
    assert.doesNotMatch(code, /\b(ALTER|DROP|UPDATE|DELETE|RENAME|REPLACE)\b/i);
    const targets = [...code.matchAll(/\b(?:CREATE TABLE|INSERT OR IGNORE INTO|ON)\s+`(\w+)`/g)].map(m => m[1]);
    assert.ok(targets.length > 10);
    for (const t of targets)
        assert.match(t, /^crm_/, t);
    for (const t of EXISTING)
        assert.ok(!new RegExp('`' + t + '`').test(code), t);
});
test('migration journal lists the CRM migration after the existing ones', () => {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    assert.deepEqual(journal.entries.map((e: { tag: string }) => e.tag), ['0000_optimal_carnage', '0001_glossy_colleen_wing', '0002_crm_phase1']);
    assert.deepEqual(TestD1.migrationFiles(), ['0000_optimal_carnage.sql', '0001_glossy_colleen_wing.sql', CRM]);
});
test('applying the CRM migration preserves existing marketplace data and schema', () => {
    const db = new TestD1();
    db.applyMigration('0000_optimal_carnage.sql');
    db.applyMigration('0001_glossy_colleen_wing.sql');
    const now = '2026-01-01T00:00:00.000Z';
    db.sqlite.prepare("INSERT INTO listings (id,slug,owner_id,seller_name,seller_email,phone,title,category,subtype,emirate,area,price,intent,description,status,created_at,updated_at) VALUES ('l1','slug-1','u1','Seller','s@example.test','+971500000000','Shop','property','Grocery','Dubai','Deira',100,'sale','A grocery for sale in Deira with stock included.','published',?,?)").run(now, now);
    db.sqlite.prepare("INSERT INTO enquiries (id,listing_id,buyer_id,name,email,phone,message,kind,created_at) VALUES ('e1','l1','u2','B','b@example.test','+971500000001','Interested','enquiry',?)").run(now);
    db.sqlite.prepare("INSERT INTO promotions (id,owner_id,listing_id,package_id,created_at) VALUES ('p1','u1','l1','reel',?)").run(now);
    const schemaOf = () => db.sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'crm_%' AND name NOT LIKE 'idx_crm_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const before = { schema: schemaOf(), listings: db.sqlite.prepare('SELECT * FROM listings').all(), enquiries: db.sqlite.prepare('SELECT * FROM enquiries').all(), promotions: db.sqlite.prepare('SELECT * FROM promotions').all() };
    db.applyMigration(CRM);
    assert.deepEqual(schemaOf(), before.schema);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM listings').all(), before.listings);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM enquiries').all(), before.enquiries);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM promotions').all(), before.promotions);
    const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%' ORDER BY name").all().map(r => r.name);
    assert.deepEqual(tables, ['crm_audit', 'crm_buyers', 'crm_counters', 'crm_documents', 'crm_listings', 'crm_sellers', 'crm_staff']);
    assert.deepEqual(db.sqlite.prepare('SELECT name, value FROM crm_counters ORDER BY name').all().map(r => ({ ...r })), [{ name: 'buyer', value: 0 }, { name: 'listing', value: 0 }, { name: 'seller', value: 0 }]);
});
test('record codes and listing-to-seller links are enforced by the database', () => {
    const db = TestD1.migrated();
    const now = '2026-01-01';
    db.sqlite.prepare("INSERT INTO crm_sellers (id,code,enquiry_date,contact_name,phone,phone_normalized,source,created_via,created_at,updated_at) VALUES ('s1','SEL-0001',?,'A','1','+1','Phone','staff',?,?)").run(now, now, now);
    assert.throws(() => db.sqlite.prepare("INSERT INTO crm_sellers (id,code,enquiry_date,contact_name,phone,phone_normalized,source,created_via,created_at,updated_at) VALUES ('s2','SEL-0001',?,'B','1','+1','Phone','staff',?,?)").run(now, now, now), /UNIQUE/);
    assert.throws(() => db.sqlite.prepare("INSERT INTO crm_listings (id,code,seller_id,business_name,category,emirate,created_at,updated_at) VALUES ('x','LST-0001','missing','Cafe','Gym','Dubai',?,?)").run(now, now), /FOREIGN KEY/);
});
