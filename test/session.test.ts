import test from 'node:test';
import assert from 'node:assert/strict';
import { googleIdTokenUser, signSession, verifySession } from '../lib/session.ts';
const secret = 'test-session-secret', now = 1_800_000_000_000, clientId = 'client.apps.googleusercontent.com';
const user = { sub: '1234', email: 'seller@example.test', name: 'Seller' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
test('signed session round-trips', async () => assert.deepEqual(await verifySession(await signSession(user, secret, now), secret, now), user));
test('tampered, expired or wrongly signed sessions are rejected', async () => {
    const token = await signSession(user, secret, now);
    const forged = `${b64({ ...user, email: 'admin@example.test', exp: now / 1000 + 600 })}.${token.split('.')[1]}`;
    assert.equal(await verifySession(forged, secret, now), null);
    assert.equal(await verifySession(token, 'other-secret', now), null);
    assert.equal(await verifySession(token, '', now), null);
    assert.equal(await verifySession(token, secret, now + 31 * 24 * 3600 * 1000), null);
    assert.equal(await verifySession('garbage', secret, now), null);
});
const claims = { iss: 'https://accounts.google.com', aud: clientId, sub: '1234', email: 'Seller@Example.test', email_verified: true, name: 'Seller', exp: now / 1000 + 600 };
const idToken = (c: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(c)}.sig`;
test('verified Google account is accepted', () => assert.deepEqual(googleIdTokenUser(idToken(claims), clientId, now), { sub: '1234', email: 'seller@example.test', name: 'Seller' }));
test('wrong audience, issuer, unverified email or expired Google token is rejected', () => {
    for (const patch of [{ aud: 'other' }, { iss: 'https://evil.example' }, { email_verified: false }, { exp: now / 1000 - 3600 }, { sub: '' }])
        assert.equal(googleIdTokenUser(idToken({ ...claims, ...patch }), clientId, now), null);
    assert.equal(googleIdTokenUser('not-a-token', clientId, now), null);
});
