import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/crm/phone.ts';
test('UAE phone formats normalise to the same E.164 number', () => {
    for (const v of ['050 123 4567', '0501234567', '+971 50 123 4567', '+971501234567', '00971501234567', '971501234567', '501234567', '+971 (0)50 123-4567', '(050) 123 4567'])
        assert.equal(normalizePhone(v), '+971501234567', v);
    assert.equal(normalizePhone('04 123 4567'), '+97141234567');
});
test('international numbers need a country code', () => {
    assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
    assert.equal(normalizePhone('0044 7700 900123'), '+447700900123');
    assert.equal(normalizePhone('7700 900123'), null);
});
test('invalid phone input is rejected', () => {
    for (const v of ['', 'abc', '+971 12', '12345', '+1234567890123456', 'call me', '050-123-4567; DROP TABLE'])
        assert.equal(normalizePhone(v), null, v);
});
