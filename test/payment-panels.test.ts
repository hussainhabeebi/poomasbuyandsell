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
