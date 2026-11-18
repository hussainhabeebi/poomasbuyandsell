// Local-only HTTP smoke test for the CRM (Phase 1). Uses an isolated local D1/R2
// state directory, local-only QA identities and Cloudflare's documented
// Turnstile test keys. It never contacts the production database.
// Run after `pnpm build`: node scripts/crm-smoke.mjs
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
const port = 8789, origin = `http://127.0.0.1:${port}`, state = '.wrangler/crm-smoke-state';
// Cloudflare test keys: always pass. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TEST_SITE_KEY = '1x00000000000000000000AA', TEST_SECRET = '1x0000000000000000000000000000000AA';
rmSync(state, { recursive: true, force: true });
execFileSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'site-creator-d1', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', state], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } });
const server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0',
    '--var', 'ADMIN_EMAILS:qa-admin@example.test', '--var', 'AUTH_TRUST_LOCAL_HEADERS:true', '--var', `TURNSTILE_SITE_KEY:${TEST_SITE_KEY}`, '--var', `TURNSTILE_SECRET_KEY:${TEST_SECRET}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let logs = '';
server.stdout.on('data', d => { logs += d; });
server.stderr.on('data', d => { logs += d; });
const who = (id, email) => ({ 'x-poomas-dev-user-id': id, 'x-poomas-dev-user-email': email });
const users = { admin: who('qa-admin', 'qa-admin@example.test'), sales: who('qa-sales', 'qa-sales@example.test'), viewer: who('qa-viewer', 'qa-viewer@example.test'), stranger: who('qa-stranger', 'qa-stranger@example.test') };
const get = (path, user = {}) => fetch(origin + path, { headers: user, redirect: 'manual', signal: AbortSignal.timeout(15000) });
const post = (path, payload, user = {}, extra = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...user, ...extra }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; console.log('PASS', label); };
try {
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Worker startup timed out')), 30000);
        const timer = setInterval(() => { if (logs.includes(`Ready on ${origin}`)) { clearTimeout(deadline); clearInterval(timer); resolve(); } }, 100);
        server.on('exit', code => { clearTimeout(deadline); clearInterval(timer); reject(new Error('Worker exited ' + code)); });
    });
    for (const path of ['/', '/properties', '/vehicles', '/sell', '/admin', '/api/market', '/enquiry/buyer', '/enquiry/seller', '/businesses-for-sale'])
        ok([200, 302, 307].includes((await get(path)).status), `GET ${path}`);
    const buyerPage = await (await get('/enquiry/buyer')).text();
    ok(buyerPage.includes(TEST_SITE_KEY) && buyerPage.includes('<h1'), 'buyer form renders with Turnstile site key');
    ok([302, 307].includes((await get('/admin/crm')).status), 'CRM redirects anonymous visitors to sign in');
    ok((await get('/api/crm/records?type=buyer')).status === 401, 'CRM API rejects anonymous requests');
    ok((await get('/api/crm/records?type=buyer', users.stranger)).status === 403, 'CRM API rejects non-staff accounts');
    ok((await (await get('/admin/crm', users.stranger)).text()).includes('CRM access required'), 'CRM page refuses non-staff accounts');
    ok((await post('/api/crm/staff', { email: 'qa-sales@example.test', name: 'QA Sales', role: 'sales', active: true }, users.admin)).status === 200, 'admin adds sales staff');
    ok((await post('/api/crm/staff', { email: 'qa-viewer@example.test', name: 'QA Viewer', role: 'readonly', active: true }, users.admin)).status === 200, 'admin adds read-only user');
    ok((await post('/api/crm/staff', { email: 'x@example.test', name: 'X', role: 'admin', active: true }, users.sales)).status === 403, 'sales cannot manage staff');
    ok((await (await get('/admin/crm', users.sales)).text()).includes('Sales staff'), 'CRM page loads for sales staff');
    ok((await post('/api/crm/records', { action: 'create', type: 'buyer', data: {} }, users.sales, { Origin: 'https://evil.example' })).status === 403, 'cross-origin writes rejected');
    const seller = { contact_name: 'QA Owner', phone: '+971 55 000 0001', email: 'owner@example.test', business_name: 'QA Cafe', business_type: 'Cafeteria', emirate: 'Dubai', asking_price: 250000, estimated_monthly_profit: 9000, source: 'Phone', status: 'New', verification_status: 'Unverified' };
    const created = await post('/api/crm/records', { action: 'create', type: 'seller', data: seller }, users.sales);
    ok(created.status === 201, 'sales creates seller');
    const { id: sellerId, code: sellerCode } = await created.json();
    ok(sellerCode === 'SEL-0001', 'seller gets SEL-0001');
    const salesView = await (await get(`/api/crm/records?type=seller&id=${sellerId}`, users.sales)).json();
    ok(!('phone' in salesView.record) && !('email' in salesView.record) && !('estimated_monthly_profit' in salesView.record), 'sales cannot see seller contact or financials');
    ok((await get(`/api/crm/records?type=seller&id=${sellerId}`, users.sales)).headers.get('cache-control')?.includes('no-store'), 'CRM responses are not cached');
    const adminView = await (await get(`/api/crm/records?type=seller&id=${sellerId}`, users.admin)).json();
    ok(adminView.record.phone === '+971 55 000 0001' && Array.isArray(adminView.audit), 'admin sees seller contact and audit history');
    const dup = await post('/api/crm/records', { action: 'create', type: 'buyer', data: { name: 'Same Phone', phone: '055 000 0001', source: 'Phone', status: 'New' } }, users.sales);
    ok(dup.status === 409 && (await dup.json()).details.duplicates[0].code === 'SEL-0001', 'duplicate phone warning links existing record');
    ok((await post('/api/crm/records', { action: 'create', type: 'buyer', data: { name: 'Viewer Try', phone: '0501110000', source: 'Phone', status: 'New' } }, users.viewer)).status === 403, 'read-only user cannot create');
    const listing = await post('/api/crm/records', { action: 'create', type: 'listing', data: { seller_id: sellerId, business_name: 'QA Cafe Deira', category: 'Cafeteria', emirate: 'Dubai', asking_price: 250000, status: 'Draft', document_verification: 'Pending', authorization_status: 'Pending' } }, users.sales);
    ok(listing.status === 201, 'sales creates linked listing');
    const { id: listingId, code: listingCode } = await listing.json();
    ok(listingCode === 'LST-0001', 'listing gets LST-0001');
    ok((await post('/api/crm/records', { action: 'update', type: 'listing', id: listingId, data: { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized' } }, users.sales)).status === 403, 'sales cannot approve a listing');
    ok((await post('/api/crm/records', { action: 'update', type: 'seller', id: sellerId, data: { verification_status: 'Owner verified' } }, users.admin)).status === 200, 'admin verifies seller');
    ok((await post('/api/crm/records', { action: 'update', type: 'listing', id: listingId, data: { status: 'Active', document_verification: 'Verified', authorization_status: 'Authorized' } }, users.admin)).status === 200, 'admin approves listing');
    ok((await (await get('/businesses-for-sale')).text()).includes(listingCode), 'approved Active listing is public');
    ok((await post('/api/crm/records', { action: 'update', type: 'listing', id: listingId, data: { status: 'Reserved' } }, users.sales)).status === 200, 'sales marks listing Reserved');
    ok(!(await (await get('/businesses-for-sale')).text()).includes(listingCode), 'Reserved listing is no longer public');
    ok(!(await (await get('/api/market')).text()).includes('QA Cafe'), 'CRM listings do not enter marketplace inventory');
    const pdf = new Blob([new TextEncoder().encode('%PDF-1.4\n% local QA document\n%%EOF\n')], { type: 'application/pdf' });
    const form = new FormData(); form.append('entityType', 'seller'); form.append('entityId', sellerId); form.append('file', pdf, 'licence.pdf');
    const upload = await fetch(origin + '/api/crm/documents', { method: 'POST', headers: { Origin: origin, ...users.admin }, body: form });
    ok(upload.status === 201, 'admin uploads confidential document');
    const { id: docId } = await upload.json();
    const salesForm = new FormData(); salesForm.append('entityType', 'seller'); salesForm.append('entityId', sellerId); salesForm.append('file', pdf, 'x.pdf');
    ok((await fetch(origin + '/api/crm/documents', { method: 'POST', headers: { Origin: origin, ...users.sales }, body: salesForm })).status === 403, 'sales cannot upload documents');
    ok((await get(`/api/crm/documents/${docId}`, users.sales)).status === 404, 'sales cannot download documents');
    ok((await get(`/api/crm/documents/${docId}`)).status === 401, 'anonymous cannot download documents');
    const download = await get(`/api/crm/documents/${docId}`, users.admin);
    ok(download.status === 200 && download.headers.get('content-disposition')?.startsWith('attachment') && download.headers.get('x-content-type-options') === 'nosniff', 'admin downloads document as attachment');
    ok((await get(`/api/media/${docId}`)).status === 404, 'documents are not reachable through public media route');
    const enquiry = { name: 'Web QA Buyer', phone: '0507770000', category: 'Gym', emirate: 'Sharjah', requirements: 'Looking for a gym with equipment', contact_method: 'WhatsApp', consent: true };
    ok((await post('/api/crm/enquiry', { kind: 'buyer', data: enquiry, turnstileToken: '' })).status === 400, 'enquiry without Turnstile token rejected');
    ok((await post('/api/crm/enquiry', { kind: 'buyer', data: enquiry, turnstileToken: 'x' }, {}, { Origin: 'https://evil.example' })).status === 403, 'cross-origin enquiry rejected');
    const web = await post('/api/crm/enquiry', { kind: 'buyer', data: enquiry, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' });
    if (web.status === 503) {
        console.log('NOTE Turnstile Siteverify unreachable from this sandbox; verified that the form fails closed (503). Re-run where challenges.cloudflare.com is reachable.');
    }
    else {
        ok(web.status === 201, 'website buyer enquiry accepted');
        const buyers = await (await get('/api/crm/records?type=buyer&source=Website', users.admin)).json();
        ok(buyers.records.some(r => r.name === 'Web QA Buyer' && r.status === 'New' && r.created_via === 'web'), 'website enquiry created a CRM buyer record');
        const sellerEnquiry = await post('/api/crm/enquiry', { kind: 'seller', data: { contact_name: 'Web QA Seller', phone: '0508880000', business_name: 'QA Salon', business_type: 'Salon', emirate: 'Ajman', relationship: 'Owner', business_details: 'Salon with four chairs', consent: true }, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' });
        ok(sellerEnquiry.status === 201, 'website seller enquiry accepted');
    }
    ok((await post('/api/crm/enquiry', { kind: 'buyer', data: { ...enquiry, phone: '0507770001' }, turnstileToken: 'x', website: 'spam' })).status === 200, 'honeypot submissions are silently dropped');
    console.log(`${checks} CRM HTTP checks passed. Local QA data lives only in ${state}.`);
}
catch (e) {
    console.error(e);
    console.error(logs.slice(-5000));
    process.exitCode = 1;
}
finally {
    server.kill('SIGTERM');
}
