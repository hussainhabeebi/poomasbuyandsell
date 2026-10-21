import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { PACKAGES } from '../lib/catalog.ts';
import { paymentStatusCopy } from '../lib/payment-display.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function compile(source: string) {
    const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    return 'data:text/javascript;base64,' + Buffer.from(js.replace(/from ['"]([^'"]+)['"]/g,
        (_, name: string) => `from ${JSON.stringify(name.startsWith('file:') || name.startsWith('data:') ? name : import.meta.resolve(name))}`)).toString('base64');
}
const enquiryModule = compile(read('components/advertising-enquiry.tsx'));
function whatsappLinks(html: string) {
    return [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&')));
}

test('advertising enquiries use the approved WhatsApp number and encoded messages for every format', async () => {
    const { AdvertisingEnquiry } = await import(enquiryModule);
    const cases: { requestId?: string; promotionName?: string }[] = [{}, ...PACKAGES.map(p => ({ requestId: 'request-123', promotionName: p.name }))];
    for (const props of cases) {
        const html = renderToStaticMarkup(createElement(AdvertisingEnquiry, props));
        const [url] = whatsappLinks(html);
        assert.equal(url.origin, 'https://wa.me');
        assert.equal(url.pathname, '/971558772494');
        const message = url.searchParams.get('text')!;
        assert.match(message, /Hi Poomas/);
        assert.match(message, /pricing/);
        if (props.requestId) {
            assert.ok(message.includes(props.requestId));
            assert.ok(message.includes(props.promotionName!));
            assert.match(message, /direct payment arrangements/);
        } else assert.match(message, /advertising on your website/);
        assert.match(html, /Enquire on WhatsApp/);
        assert.match(html, /rel="noopener noreferrer"/);
        assert.doesNotMatch(html, /<button|nomod|checkout/i);
    }
});

test('missing details and special characters cannot change the WhatsApp destination or add query parameters', async () => {
    const { AdvertisingEnquiry } = await import(enquiryModule);
    const cases: { requestId?: string; promotionName?: string }[] = [
        { requestId: 'request-123' },
        { requestId: '', promotionName: '' },
        { promotionName: 'Instagram Story' },
        { requestId: 'id?&text=override#fragment', promotionName: 'Story & Reel / “عرض” <script> "quoted"' },
    ];
    for (const props of cases) {
        const html = renderToStaticMarkup(createElement(AdvertisingEnquiry, props));
        const [url] = whatsappLinks(html);
        assert.equal(url.origin + url.pathname, 'https://wa.me/971558772494');
        assert.deepEqual([...url.searchParams.keys()], ['text']);
        assert.equal(url.hash, '');
        const text = url.searchParams.get('text')!;
        if (props.requestId) {
            assert.ok(text.includes(props.requestId));
            if (props.promotionName) assert.ok(text.includes(props.promotionName));
        }
        assert.doesNotMatch(html, /undefined|<script>/);
        assert.doesNotMatch(text, /seller@example|customer@example|token=|secret=/);
    }
});

test('seller promotion rows render WhatsApp rather than checkout across all formats and historical statuses', async () => {
    const source = read('components/marketplace.tsx');
    const dashboard = source.slice(source.indexOf('export function Dashboard'));
    // Render the real dashboard JSX with an isolated loaded-state fixture.
    // Effects and event handlers are not executed; no network or database is used.
    const fixture = {
        listings: [], saved: [], enquiries: [],
        promotions: PACKAGES.flatMap(p => ['requested', 'quoted', 'awaiting_payment', 'paid', 'refunded', 'partially_refunded', 'disputed'].map(status => ({
            id: `${p.id}-${status}`, package_id: p.id, title: 'Fixture listing', status, amount: 100, verifiedPayment: true,
        }))),
    };
    const prefix = `
        import { createElement } from 'react';
        import { AdvertisingEnquiry } from ${JSON.stringify(enquiryModule)};
        import { PACKAGES } from ${JSON.stringify(new URL('../lib/catalog.ts', import.meta.url).href)};
        import { paymentStatusCopy, paymentMoney } from ${JSON.stringify(new URL('../lib/payment-display.ts', import.meta.url).href)};
        const data = ${JSON.stringify(fixture)};
        const useState = initial => [initial === null ? data : initial === 'listings' ? 'promotions' : initial, () => {}];
        const useRef = value => ({current:value}), useCallback = fn => fn, useEffect = () => {};
        const useMarketplaceSearchParams = () => new URLSearchParams();
        const Link = ({children, href, ...props}) => createElement('a', {...props, href}, children);
        const Tabs = ({children}) => children, TabsList = Tabs, TabsTrigger = Tabs;
        const Plus = () => null;
    `;
    const { Dashboard } = await import(compile(prefix + dashboard));
    const html = renderToStaticMarkup(createElement(Dashboard, { viewer: { name: 'Fixture Seller', email: 'seller@example.test', admin: false }, admin: false }));
    assert.equal(whatsappLinks(html).length, fixture.promotions.length);
    assert.match(html, /Payment verified/);
    assert.match(html, /Payment refunded/);
    assert.match(html, /Payment disputed/);
    assert.doesNotMatch(html, /Pay with Nomod|Opening checkout|Set quote|api\/checkout/);
    assert.doesNotMatch(source, /api\('\/api\/checkout'|async function checkout|checkoutPending|safeCheckoutDestination/);
    assert.match(source, /admin && <NomodRecoveryPanel/);
});

test('promotion page offers WhatsApp enquiries to guests and signed-in sellers without creating checkout', async () => {
    const source = read('components/marketplace.tsx');
    const page = source.slice(source.indexOf('export function PromotionPage'), source.indexOf('export function SellForm'));
    const prefix = `
        import { createElement, useState, useEffect } from 'react';
        import { Camera as Instagram, Video, CheckCircle2, Check, ShieldCheck, LoaderCircle } from 'lucide-react';
        import { AdvertisingEnquiry } from ${JSON.stringify(enquiryModule)};
        import { PACKAGES } from ${JSON.stringify(new URL('../lib/catalog.ts', import.meta.url).href)};
        const Link = ({children, href, ...props}) => createElement('a', {...props, href}, children);
        const NativeSelect = props => createElement('select', props);
        const signIn = path => '/signin?return=' + encodeURIComponent(path);
    `;
    const { PromotionPage } = await import(compile(prefix + page));
    for (const viewer of [null, { name: 'Seller', email: 'seller@example.test', admin: false }]) {
        const html = renderToStaticMarkup(createElement(PromotionPage, { viewer }));
        assert.equal(whatsappLinks(html)[0].pathname, '/971558772494');
        assert.match(html, /Online payments are disabled/);
        assert.doesNotMatch(html, /Nomod|Pay with|Opening checkout/);
        for (const promotion of PACKAGES) assert.ok(html.includes(promotion.name));
    }
});

test('failed and cancelled historical payments direct customers to the team, preserving verified outcomes', () => {
    for (const attempt of ['attempt_failed', 'attempt_cancelled']) {
        const copy = paymentStatusCopy('awaiting_payment', false, attempt);
        assert.match(copy.message, /Contact the team on WhatsApp/);
        assert.match(copy.message, /Online payments are disabled/);
        assert.doesNotMatch(copy.message, /retry.*checkout/i);
        assert.equal(paymentStatusCopy('paid', true, attempt).title, 'Payment verified');
    }
    for (const status of ['refunded', 'partially_refunded', 'disputed']) {
        assert.equal(paymentStatusCopy(status, true).pending, false);
    }
});

test('advertising metadata and policies describe direct arrangements without offering hosted checkout', () => {
    for (const path of ['app/promote/page.tsx', 'app/privacy/page.tsx', 'app/terms/page.tsx']) {
        const source = read(path);
        assert.match(source, /WhatsApp/);
        assert.doesNotMatch(source, /Nomod|hosted checkout/);
    }
    assert.match(read('app/privacy/page.tsx'), /retained for payment reconciliation, disputes/);
    assert.match(read('lib/nomod.ts'), /NOMOD_RELEASE_APPROVED = false/);
});
