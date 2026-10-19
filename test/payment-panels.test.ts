import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function moduleUrl(source: string) { return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); }
function compile(path: string, replacements: Record<string, string> = {}) {
    const js = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    return moduleUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, name: string) => {
        const target = replacements[name] || (name.startsWith('../lib/') ? new URL(name + '.ts', import.meta.url).href : import.meta.resolve(name));
        return `from ${JSON.stringify(target)}`;
    }));
}
async function panels() {
    return import(compile('components/payment-panels.tsx', {
        './payment-panels.module.css': moduleUrl('export default {panel:"panel",list:"list",actions:"actions"}'),
    }));
}
test('return panel initial render never claims success from an order hint', async () => {
    const { PaymentReturn } = await panels();
    const html = renderToStaticMarkup(createElement(PaymentReturn, { promotion: '11111111-1111-4111-8111-111111111111', onStatus() {} }));
    assert.match(html, /Checking payment status/);
    assert.match(html, /Returning from Nomod is not proof of payment/);
    assert.doesNotMatch(html, /Payment verified|Service activated/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /Refresh payment status/);
});
test('legacy return panel offers account guidance without selecting an arbitrary order', async () => {
    const { PaymentReturn } = await panels();
    const html = renderToStaticMarkup(createElement(PaymentReturn, { promotion: '', onStatus() {} }));
    assert.match(html, /Welcome back from checkout/);
    assert.match(html, /Older checkout links may not identify a specific promotion/);
    assert.doesNotMatch(html, /Payment verified|Refresh payment status/);
});
test('operator panel initial render does not expose a recovery action before authorization data loads', async () => {
    const { NomodRecoveryPanel } = await panels();
    const html = renderToStaticMarkup(createElement(NomodRecoveryPanel));
    assert.match(html, /Nomod payment recovery/);
    assert.match(html, /Loading recovery information/);
    assert.doesNotMatch(html, /Verify and adopt original link|Replay pending events for this order/);
});
test('sign-in return target preserves only approved payment navigation hints', async () => {
    const authUrl = moduleUrl('export const targets=[]; export async function requireUser(target){targets.push(target);return {displayName:"Test",email:"test@example.test"}}');
    const component = await import(compile('app/account/page.tsx', {
        '@/components/marketplace': moduleUrl('export function Dashboard(){return null}'),
        '@/app/auth': authUrl,
        '@/lib/server': moduleUrl('export function isAdmin(){return false}'),
        '@/lib/pages': moduleUrl('export function meta(){return {}}'),
    }));
    const { targets } = await import(authUrl);
    const id = '11111111-1111-4111-8111-111111111111';
    await component.default({ searchParams: Promise.resolve({ payment: 'returned', promotion: id, status: 'paid', redirect: 'https://evil.example' }) });
    assert.equal(targets.at(-1), `/account?payment=returned&promotion=${id}`);
    await component.default({ searchParams: Promise.resolve({ payment: 'paid', promotion: id }) });
    assert.equal(targets.at(-1), '/account');
    await component.default({ searchParams: Promise.resolve({ payment: 'failed', promotion: 'bad' }) });
    assert.equal(targets.at(-1), '/account?payment=failed');
});

async function paymentActions() { return import(compile('components/promotion-payment-actions.tsx')); }
const ad = { id: '11111111-1111-4111-8111-111111111111', package_id: 'boost', status: 'quoted', amount: 137.65, currency: 'AED' };
function actionsHtml(Component: typeof import('../components/promotion-payment-actions')['PromotionPaymentActions'], patch: Record<string, unknown> = {}) {
    return renderToStaticMarkup(createElement(Component, { promotion: ad, admin: false, busy: false, paymentsEnabled: false, onQuote() {}, onCheckout() {}, ...patch }));
}

test('website-ad checkout stays hidden while payment availability is disabled or still loading', async () => {
    const { PromotionPaymentActions } = await paymentActions();
    for (const status of ['quoted', 'awaiting_payment']) {
        const html = actionsHtml(PromotionPaymentActions, { promotion: { ...ad, status } });
        assert.match(html, /Online payments are not available yet/);
        assert.match(html.replaceAll('\u00a0', ' '), /AED 137.65/);
        assert.doesNotMatch(html, /Pay with Nomod/);
    }
});

test('only eligible website ads show future checkout, and busy requests disable repeat submission', async () => {
    const { PromotionPaymentActions } = await paymentActions();
    for (const status of ['quoted', 'awaiting_payment']) {
        const html = actionsHtml(PromotionPaymentActions, { promotion: { ...ad, status }, paymentsEnabled: true });
        assert.match(html, /Pay with Nomod/);
    }
    const busy = actionsHtml(PromotionPaymentActions, { paymentsEnabled: true, busy: true });
    assert.match(busy, /disabled=""/); assert.match(busy, /Opening checkout/);
    for (const status of ['requested', 'creating_payment', 'paid', 'partially_refunded', 'refunded', 'disputed']) {
        assert.doesNotMatch(actionsHtml(PromotionPaymentActions, { promotion: { ...ad, status }, paymentsEnabled: true }), /Pay with Nomod/);
    }
});

test('video/social and unknown requests never offer checkout or online quote approval, including legacy quotations', async () => {
    const { PromotionPaymentActions } = await paymentActions();
    for (const package_id of ['story', 'reel', 'shoot', 'unknown', 'BOOST', 'boost ']) for (const admin of [false, true]) {
        const html = actionsHtml(PromotionPaymentActions, { promotion: { ...ad, package_id }, paymentsEnabled: true, admin });
        assert.match(html, /only for website ads/);
        assert.doesNotMatch(html, /Pay with Nomod|Set website-ad quote/);
        assert.match(html.replaceAll('\u00a0', ' '), /AED 137.65/, 'stored historic amount remains visible');
    }
});

test('only admin website-ad requests offer quote approval and explain the unresolved advertising terms', async () => {
    const { PromotionPaymentActions } = await paymentActions();
    const html = actionsHtml(PromotionPaymentActions, { admin: true });
    assert.match(html, /Set website-ad quote/);
    assert.match(html, /placement, duration, price and cancellation\/refund terms/);
    assert.doesNotMatch(html, /Pay with Nomod/);
    assert.doesNotMatch(actionsHtml(PromotionPaymentActions), /Set website-ad quote/);
    assert.doesNotMatch(actionsHtml(PromotionPaymentActions, { admin: true, promotion: { ...ad, status: 'paid' } }), /Set website-ad quote/);
});

let availabilityHarnessId = 0;
async function availabilityHarness() {
    const react = moduleUrl(`
        export const instance=${++availabilityHarnessId};
        export const updates=[], cleanups=[];
        export function useState(initial){return [initial,value=>updates.push(value)]}
        export function useEffect(effect){cleanups.push(effect())}
    `);
    return { state: await import(react), hooks: await import(compile('components/promotion-payment-actions.tsx', { react })) };
}

test('payment availability accepts only a successful exact boolean and fails closed for errors or malformed data', async () => {
    const original = globalThis.fetch;
    try {
        for (const [response, expected] of [
            [() => Response.json({ paymentsEnabled: true }), true],
            [() => Response.json({ paymentsEnabled: false }), false],
            [() => Response.json({ paymentsEnabled: 'true' }), false],
            [() => Response.json({}), false],
            [() => Response.json(null), false],
            [() => Response.json(true), false],
            [() => Response.json({ paymentsEnabled: true }, { status: 503 }), false],
            [() => new Response('{'), false],
            [() => { throw new Error('mock unavailable'); }, false],
        ] as const) {
            let requests = 0;
            globalThis.fetch = (async (url, options) => {
                assert.equal(url, '/api/checkout'); assert.equal(options?.cache, 'no-store');
                assert.equal(options?.method, undefined); assert.equal(options?.body, undefined);
                requests++; return response();
            }) as typeof fetch;
            const { state, hooks } = await availabilityHarness();
            assert.equal(hooks.usePaymentAvailability(), false, 'initial rendering fails closed');
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(state.updates.at(-1), expected);
            assert.equal(requests, 1);
            state.cleanups[0]();
        }
    } finally { globalThis.fetch = original; }
});

test('a readiness response after unmount cannot enable checkout', async () => {
    const original = globalThis.fetch;
    try {
        let resolveResponse!: (response: Response) => void;
        let signal: AbortSignal | null | undefined;
        globalThis.fetch = ((_url, options) => {
            signal = options?.signal;
            return new Promise<Response>(resolve => { resolveResponse = resolve; });
        }) as typeof fetch;
        const { state, hooks } = await availabilityHarness();
        hooks.usePaymentAvailability(); state.cleanups[0]();
        assert.equal(signal?.aborted, true);
        resolveResponse(Response.json({ paymentsEnabled: true }));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(state.updates, [false]);
    } finally { globalThis.fetch = original; }
});

test('admin-only rendering does not request seller checkout availability', async () => {
    const original = globalThis.fetch;
    try {
        let requests = 0;
        globalThis.fetch = (async () => { requests++; throw new Error('no request expected'); }) as typeof fetch;
        const { state, hooks } = await availabilityHarness();
        assert.equal(hooks.usePaymentAvailability(false), false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests, 0); assert.deepEqual(state.updates, [false]);
    } finally { globalThis.fetch = original; }
});
