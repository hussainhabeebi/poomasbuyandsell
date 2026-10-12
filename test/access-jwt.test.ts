import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyAccessJwt } from '../lib/access-jwt.ts';
const domain = 'poomas.cloudflareaccess.com', aud = 'test-aud', now = 1_800_000_000_000;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certs = async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }));
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function sign(claims: Record<string, unknown>, key = privateKey, kid = 'k1') { const body = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`; return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`; }
const claims = { aud: [aud], email: 'seller@example.test', sub: 'user-1', iss: `https://${domain}`, exp: now / 1000 + 600, iat: now / 1000 };
test('valid Access token is accepted', async () => assert.equal((await verifyAccessJwt(sign(claims), domain, aud, now, certs))?.email, 'seller@example.test'));
test('wrong audience, issuer, expiry, key or tampering is rejected', async () => {
    for (const token of [sign({ ...claims, aud: ['other'] }), sign({ ...claims, iss: 'https://evil.cloudflareaccess.com' }), sign({ ...claims, exp: now / 1000 - 3600 }), sign(claims, other.privateKey), sign(claims, privateKey, 'k2'), sign(claims).replace(/\.[^.]+\./, `.${b64({ ...claims, email: 'admin@example.test' })}.`), 'not.a.jwt', ''])
        assert.equal(await verifyAccessJwt(token, domain, aud, now, certs), null);
});
