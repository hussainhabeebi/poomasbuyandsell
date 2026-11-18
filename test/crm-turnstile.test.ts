import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile, SITEVERIFY_URL } from '../lib/crm/turnstile.ts';
const reply = (body: unknown, ok = true) => (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
test('Turnstile fails closed when not configured or token missing', async () => {
    assert.equal(await verifyTurnstile('token', '', null, reply({ success: true })), 'unconfigured');
    assert.equal(await verifyTurnstile('', 'secret', null, reply({ success: true })), 'failed');
    assert.equal(await verifyTurnstile(undefined, 'secret', null, reply({ success: true })), 'failed');
    assert.equal(await verifyTurnstile('x'.repeat(3000), 'secret', null, reply({ success: true })), 'failed');
});
test('Turnstile result follows Siteverify', async () => {
    assert.equal(await verifyTurnstile('token', 'secret', '1.2.3.4', reply({ success: true })), 'ok');
    assert.equal(await verifyTurnstile('token', 'secret', null, reply({ success: false, 'error-codes': ['invalid-input-response'] })), 'failed');
    assert.equal(await verifyTurnstile('token', 'secret', null, reply({}, false)), 'unavailable');
    assert.equal(await verifyTurnstile('token', 'secret', null, (async () => { throw new Error('network'); }) as unknown as typeof fetch), 'unavailable');
});
test('Turnstile sends secret, token and client IP to Siteverify', async () => {
    let seen: { url: string; form: FormData } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => { seen = { url, form: init.body as FormData }; return new Response('{"success":true}'); }) as unknown as typeof fetch;
    await verifyTurnstile('tok', 'sec', '5.6.7.8', fetcher);
    assert.equal(seen!.url, SITEVERIFY_URL);
    assert.equal(seen!.form.get('secret'), 'sec');
    assert.equal(seen!.form.get('response'), 'tok');
    assert.equal(seen!.form.get('remoteip'), '5.6.7.8');
});
