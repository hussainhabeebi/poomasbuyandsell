import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { EMIRATES } from '../lib/catalog.ts';
import { BROWSE_CATEGORIES, browseHref } from '../lib/browsing.ts';

// Exercise the actual component's server output; no browser or JS hydration.
async function renderDirectory() {
    const source = await readFile(new URL('../components/location-browse.tsx', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const resolved = compiled.replace(/from ['"]([^'"]+)['"]/g, (_, name: string) => {
        const url = name.startsWith('@/lib/') ? new URL(`../lib/${name.slice(6)}.ts`, import.meta.url).href : import.meta.resolve(name);
        return `from ${JSON.stringify(url)}`;
    });
    const component = await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
    return renderToStaticMarkup(createElement(component.BrowseLocations));
}

test('initial server HTML retains exactly all 21 original descriptive links and destinations', async () => {
    const html = await renderDirectory();
    assert.equal((html.match(/<a href=/g) || []).length, 21);
    for (const emirate of EMIRATES) for (const category of BROWSE_CATEGORIES) {
        const href = browseHref(category.path, category.intent, emirate).replaceAll('&', '&amp;');
        assert.ok(html.includes(`href="${href}"`), href);
        assert.ok(html.includes(`${category.locationLabel} in ${emirate}`));
    }
});

test('without JavaScript the complete directory is visible and tab controls do not interfere', async () => {
    const html = await renderDirectory();
    assert.equal((html.match(/class="location-panel" role="region"/g) || []).length, 7);
    assert.equal((html.match(/class="location-panel"[^>]*hidden/g) || []).length, 0);
    assert.ok(html.includes('class="location-tab-scroll" hidden=""'));
    assert.ok(html.includes('data-directory="true"'));
    assert.ok(html.includes('Discover commercial properties and vehicles across the UAE.'));
});

test('seven tab associations have unique stable targets and Dubai is the only selected tab', async () => {
    const html = await renderDirectory();
    assert.equal((html.match(/role="tab"/g) || []).length, 7);
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
    for (let i = 0; i < EMIRATES.length; i++) {
        assert.ok(html.includes(`id="location-tab-${i}" aria-controls="location-panel-${i}" aria-selected="${i === 0}"`));
        assert.ok(html.includes(`id="location-panel-${i}"`));
    }
});
