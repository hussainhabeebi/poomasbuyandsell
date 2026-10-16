// Optional local browser regression: node test/payment-panels.browser.mjs
// Requires an installed Playwright Chromium. Uses actual components + mocked
// same-origin APIs only; never starts the app Worker or connects to Nomod/D1.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright and Chromium to run the optional browser regression.');
    ({ chromium } = createRequire(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))('playwright'));
}
const dir = resolve('.wrangler/nomod-browser-test');
await mkdir(dir, { recursive: true });
await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {PaymentReturn,NomodRecoveryPanel} from './components/payment-panels.tsx';
        const p=new URLSearchParams(location.search);
        createRoot(document.getElementById('root')).render(p.get('mode')==='operator'
            ? <NomodRecoveryPanel/> : <PaymentReturn promotion={p.get('promotion')||''} onStatus={()=>{}}/>);`,
        resolveDir: process.cwd(), loader: 'tsx' },
    outfile: resolve(dir, 'panel.js'), bundle: true, format: 'esm', jsx: 'automatic',
});
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/panel.css"><style>
:root{--line:#e3e8eb;--bg:#f7f9fa;--muted:#6b7882}*{box-sizing:border-box}body{margin:20px;color:#122434;font-family:Arial,sans-serif}button,input{font:inherit}button,input{padding:12px}button{min-height:44px}button:disabled{opacity:.6}small{line-height:1.5}h2{line-height:1.2}#root{max-width:1200px;margin:auto}
</style></head><body><div id="root"></div><script type="module" src="/panel.js"></script></body></html>`;
let state, overview, statusReads = 0, recoveryReads = 0;
const posts = [];
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/promotions/payment-status') {
        statusReads++; res.writeHead(state.error ? 404 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state));
    } else if (url.pathname === '/api/nomod/reconcile') {
        if (req.method === 'POST') { let raw=''; for await (const chunk of req) raw+=chunk; posts.push(JSON.parse(raw)); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({message:'Recovery pass finished. Check event outcomes.'})); }
        else { recoveryReads++; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(overview)); }
    } else if (url.pathname === '/panel.js' || url.pathname === '/panel.css') {
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(resolve(dir, url.pathname.slice(1))));
    } else { res.setHeader('Content-Type','text/html'); res.end(html); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({headless:true, executablePath:chromium.executablePath()});
    const page = await browser.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const id='11111111-1111-4111-8111-111111111111', link='22222222-2222-4222-8222-222222222222';
    state={id,title:'Test commercial listing',packageId:'boost',amount:100,currency:'AED',status:'awaiting_payment',verified:false,lastAttempt:null};
    await page.clock.install();
    await page.goto(`${base}/?promotion=${id}`);
    await page.getByRole('heading',{name:'Awaiting payment confirmation',exact:true}).waitFor();
    const before=statusReads;
    for(let i=0;i<5;i++){ const response=page.waitForResponse(r=>r.url().includes('/payment-status')); await page.clock.fastForward(5000); await response; await page.getByRole('button',{name:'Refresh payment status',exact:true}).waitFor(); }
    await page.clock.fastForward(30000); assert.equal(statusReads-before,5,'Automatic status polling is capped at six reads total');
    state={...state,status:'paid',verified:true};
    await page.getByRole('button',{name:'Refresh payment status',exact:true}).click();
    await page.getByRole('heading',{name:'Payment verified',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/delivery and scheduling are handled separately/);
    state={error:'Promotion not found in your account.'};
    await page.getByRole('button',{name:'Refresh payment status',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Payment verified',exact:true}).count(),0,'Stale paid status clears on failed refresh');
    await page.goto(base);
    await page.getByRole('heading',{name:'Welcome back from checkout',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/Older checkout links/);
    state={id,title:'Test commercial listing',packageId:'story',amount:100,currency:'AED',status:'refunded',verified:true,lastAttempt:null};
    await page.evaluate(value=>sessionStorage.setItem('poomas:checkout-promotion',value),id);
    await page.reload(); await page.getByRole('heading',{name:'Payment refunded',exact:true}).waitFor();
    const event={id:'33333333-3333-4333-8333-333333333333',order_id:id,title:'Test commercial listing',type:'charge.completed',outcome:'pending_provider',received_at:'2026-01-01T00:00:00Z',attempts:1,last_attempt_at:null};
    overview={enabled:false,verificationLimit:5,cooldownMs:60000,batchSize:10,page:0,hasMore:false,events:[event],attempts:[{order_id:id,title:'Test commercial listing',state:'ambiguous',attempt_id:link}]};
    await page.goto(`${base}/?mode=operator`); await page.getByRole('heading',{name:'Unresolved or rejected events'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Replay pending events for this order',exact:true}).isDisabled(),true);
    for(const width of [375,390,768,1024,1440]) {
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Operator panel overflow at ${width}`);
        await page.screenshot({path:resolve(dir,`operator-${width}.png`),fullPage:true});
    }
    overview={...overview,enabled:true}; await page.getByRole('button',{name:'Refresh recovery information',exact:true}).click();
    const replay=page.getByRole('button',{name:'Replay pending events for this order',exact:true}); await replay.waitFor();
    await replay.click(); await page.getByText('Recovery pass finished. Check event outcomes.',{exact:true}).waitFor();
    assert.deepEqual(posts[0],{id});
    await page.getByLabel('Original Nomod link UUID').fill(link);
    const adopted=page.waitForResponse(r=>r.url().includes('/api/nomod/reconcile')&&r.request().method()==='GET');
    await page.getByRole('button',{name:'Verify and adopt original link',exact:true}).click();
    await adopted;
    assert.deepEqual(posts[1],{id,linkId:link});
    overview={...overview,events:[{...event,attempts:5}],attempts:[]};
    await page.getByRole('button',{name:'Refresh recovery information',exact:true}).click();
    await page.getByText('5/5 checks · Manual investigation required',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Replay pending events for this order',exact:true}).count(),0);
    state={id,title:'Test commercial listing',packageId:'shoot',amount:100,currency:'AED',status:'disputed',verified:true,lastAttempt:null};
    await page.goto(`${base}/?promotion=${id}`); await page.getByRole('heading',{name:'Payment disputed',exact:true}).waitFor();
    for(const width of [375,390,768,1024,1440]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Return panel overflow at ${width}`);
        await page.screenshot({path:resolve(dir,`return-${width}.png`),fullPage:true});
    }
    console.log(`PASS: bounded polling, saved status/refresh, error clearing, legacy return hints, disabled controls, replay/adoption payloads, exhausted budget; both panels at 375/390/768/1024/1440px. ${posts.length} mock recovery POSTs; zero provider/Worker/database requests.`);
} finally { await browser?.close(); await new Promise(r=>server.close(r)); }
