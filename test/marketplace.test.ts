import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { listingInput, paymentMatches, safeVideo } from '../lib/validation.ts';
import { publicListing, decodeListing } from '../lib/catalog.ts';
import { verifyNomodSignature, nextPaymentState } from '../lib/webhook.ts';
const image = '/api/media/11111111-1111-4111-8111-111111111111';
const valid = { title: 'Fitted office with parking', category: 'property', subtype: 'Office', emirate: 'Dubai', area: 'Business Bay', price: 100000, intent: 'rent', description: 'A fitted office. Ask the seller about parking, service charges and permitted use.', phone: '+971501234567', sellerName: 'Owner', specs: { Area: '1000' }, images: [image] };
test('UAE annual property rental is accepted', () => assert.equal(listingInput.safeParse(valid).success, true));
test('invalid category, emirate, negative price and duplicate photos are rejected', () => { for (const patch of [{ subtype: 'SUV' }, { emirate: 'Unknown' }, { price: -1 }, { images: [] }, { images: [image, image] }, { images: ['https://example.com/stolen.jpg'] }])
    assert.equal(listingInput.safeParse({ ...valid, ...patch }).success, false); });
test('vehicle rentals are outside supported scope', () => assert.equal(listingInput.safeParse({ ...valid, category: 'vehicle', subtype: 'SUV' }).success, false));
test('video URLs reject lookalike hosts, executable protocols and arbitrary destinations', () => { assert.equal(safeVideo('https://youtu.be/abc'), true); for (const url of ['https://youtube.com.evil.example/watch', 'javascript:alert(1)', 'http://youtube.com/watch', 'https://example.com/video'])
    assert.equal(safeVideo(url), false); });
test('public listing data never exposes account identity, private email, phone or rejection notes', () => { const l = decodeListing({ ...valid, id: 'a', owner_id: 'private-user', seller_email: 'private@example.com', phone: '+971501234567', rejection_reason: 'private review', specs: '{}', images: '[]' }); const published = publicListing(l); for (const key of ['owner_id', 'seller_email', 'phone', 'rejection_reason'])
    assert.equal(key in published, false); });
const order = { id: 'abc', amount: 100, currency: 'AED' };
const payment = { note: 'Poomas promotion abc', status: 'paid', originalCurrency: 'AED', originalTotal: '100.00' };
test('payments require exact reference, amount, currency and settled status', () => { assert.equal(paymentMatches(payment, order), true); for (const patch of [{ note: 'Poomas promotion xyz' }, { originalCurrency: 'USD' }, { originalTotal: '99.00' }, { status: 'authorised' }, { originalTotal: 'NaN' }])
    assert.equal(paymentMatches({ ...payment, ...patch }, order), false); });
const now = 1700000000000, timestamp = String(now / 1000), raw = JSON.stringify({ eventId: 'event1', type: 'charge.completed' }), id = 'message1', secret = 'whsec_' + Buffer.from('test-signature-secret-only').toString('base64');
const signature = 'v1,' + createHmac('sha256', Buffer.from('test-signature-secret-only')).update(`${id}.${timestamp}.${raw}`).digest('base64');
test('Nomod authenticates raw payload and accepts key rotation signatures', () => { assert.equal(verifyNomodSignature(raw, { id, timestamp, signature }, secret, now), true); assert.equal(verifyNomodSignature(raw, { id, timestamp, signature: 'v1,invalid ' + signature }, secret, now), true); });
test('tampered, stale, future or missing webhook headers are rejected', () => { assert.equal(verifyNomodSignature(raw + ' ', { id, timestamp, signature }, secret, now), false); assert.equal(verifyNomodSignature(raw, { id, timestamp, signature }, secret, now + 301000), false); assert.equal(verifyNomodSignature(raw, { id, timestamp, signature }, secret, now - 301000), false); assert.equal(verifyNomodSignature(raw, { id: null, timestamp, signature }, secret, now), false); });
test('late completed events cannot resurrect refunded or disputed promotions', () => { assert.equal(nextPaymentState('charge.completed', 'awaiting_payment', true), 'paid'); assert.equal(nextPaymentState('charge.completed', 'awaiting_payment', false), null); for (const state of ['refunded', 'partially_refunded', 'disputed', 'paid', 'quoted'])
    assert.equal(nextPaymentState('charge.completed', state, true), null); assert.equal(nextPaymentState('charge.refunded', 'paid', false), 'refunded'); assert.equal(nextPaymentState('charge.dispute.created', 'paid', false), 'disputed'); });
