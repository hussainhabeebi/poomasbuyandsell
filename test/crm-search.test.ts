import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearch } from '../lib/crm/search.ts';
test('search builds parameterised SQL from whitelisted filters only', () => {
    const { where, binds } = buildSearch('buyer', { q: "x' OR 1=1 --", status: 'New', category: 'Cafeteria', emirate: 'Dubai', min: '100000', max: '300000', source: 'Website', assigned_to: 'a@x.test', follow_up_from: '2026-01-01', follow_up_to: 'bad', duplicates: '1', ...({ evil: 'DROP TABLE' } as object) });
    assert.ok(!where.includes("'x"));
    assert.ok(!where.includes('DROP'));
    assert.ok(where.includes('status = ?') && where.includes('category = ?') && where.includes('source = ?') && where.includes('next_follow_up_date >= ?'));
    assert.ok(!where.includes('next_follow_up_date <= ?'));
    assert.ok(where.includes('budget_max IS NULL OR budget_max >= ?') && where.includes('budget_min IS NULL OR budget_min <= ?'));
    assert.ok(where.includes('duplicate_of IS NOT NULL'));
    assert.ok(binds.includes(100000) && binds.includes(300000));
});
test('search recognises record IDs and phone numbers and escapes LIKE wildcards', () => {
    const r = buildSearch('seller', { q: '050 123 4567' });
    assert.ok(r.binds.includes('+971501234567'));
    assert.ok(r.where.includes('phone_normalized = ?'));
    assert.ok(buildSearch('listing', { q: '0501234567' }).where.indexOf('phone_normalized') === -1);
    assert.ok(buildSearch('buyer', { q: 'buy-0001' }).binds.includes('BUY-0001'));
    assert.ok(buildSearch('buyer', { q: '50%_off' }).binds.includes('%50\\%\\_off%'));
    assert.deepEqual(buildSearch('buyer', {}), { where: '', binds: [] });
});
test('listing search uses asking price and an alias', () => {
    const r = buildSearch('listing', { min: '5', max: '10', seller_id: 'abc', source: 'Website' }, 'r');
    assert.ok(r.where.includes('r.asking_price >= ?') && r.where.includes('r.asking_price <= ?') && r.where.includes('r.seller_id = ?'));
    assert.ok(!r.where.includes('source'));
});
