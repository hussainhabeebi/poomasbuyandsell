// Local-only rehearsal of the CRM migration. It never uses --remote.
//
//   node scripts/crm-migration-check.mjs
//     Builds a database like production before the CRM (0000 + 0001 applied,
//     sample marketplace rows), then upgrades it with the real
//     `wrangler d1 migrations apply`.
//
//   node scripts/crm-migration-check.mjs --from-export poomas-d1-before-crm.sql
//     Same check against a full export of the production database
//     (`wrangler d1 export ... --remote`). The export contains personal data:
//     run this only on an administrator's machine and delete the
//     .wrangler/crm-migration-check state afterwards (the script does so).
//
// It fails unless every existing table, index, row and migration record is
// byte-identical after the upgrade, the only additions are crm_* objects, the
// three counter rows and the 0002 migration record, and re-running the
// migration is a no-op. Run `pnpm build` first.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const state = '.wrangler/crm-migration-check', preConfig = 'dist/server/wrangler.crm-check.json', preDir = path.join(state, 'pre-crm-migrations');
const exportIndex = process.argv.indexOf('--from-export'), exportFile = exportIndex > 0 ? process.argv[exportIndex + 1] : null;
if (!existsSync('dist/server/wrangler.json'))
    throw new Error('Run pnpm build first.');
const wrangler = (args) => execFileSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
const local = (config) => ['--local', '--config', config, '--persist-to', state];
const sqliteFile = () => readdirSync(path.join(state, 'v3/d1/miniflare-D1DatabaseObject')).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite').map(f => path.join(state, 'v3/d1/miniflare-D1DatabaseObject', f))[0];
function snapshot() {
    const db = new DatabaseSync(sqliteFile(), { readOnly: true }), lines = [];
    for (const o of db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()) {
        lines.push(`SCHEMA ${o.type} ${o.name}: ${String(o.sql).replace(/\s+/g, ' ')}`);
        if (o.type === 'table')
            for (const r of db.prepare(`SELECT * FROM "${o.name}" ORDER BY rowid`).all())
                lines.push(`ROW ${o.name}: ${JSON.stringify(r)}`);
    }
    db.close();
    return lines;
}
const SAMPLE = `INSERT INTO listings (id,slug,owner_id,seller_name,seller_email,phone,title,category,subtype,emirate,area,price,intent,description,specs,images,status,created_at,updated_at) VALUES
('11111111-1111-4111-8111-111111111111','deira-grocery-11111111','u-seller','Seller One','seller@example.test','+971500000001','Deira grocery for sale','property','Grocery','Dubai','Deira',150000,'sale','Established grocery in Deira with stock and fittings included in the sale.','{"size":"800"}','[]','published','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
('22222222-2222-4222-8222-222222222222','sharjah-suv-22222222','u-seller','Seller One','seller@example.test','+971500000001','2022 SUV low mileage','vehicle','SUV','Sharjah','Al Nahda',90000,'sale','Well maintained SUV with full service history and one previous owner.','{}','[]','pending','2026-01-02T00:00:00.000Z','2026-01-02T00:00:00.000Z');
INSERT INTO saved (id,user_id,listing_id,created_at) VALUES ('s1','u-buyer','11111111-1111-4111-8111-111111111111','2026-01-03T00:00:00.000Z');
INSERT INTO enquiries (id,listing_id,buyer_id,name,email,phone,message,kind,created_at) VALUES ('e1','11111111-1111-4111-8111-111111111111','u-buyer','Buyer','buyer@example.test','+971500000002','Is this still available?','enquiry','2026-01-03T00:00:00.000Z');
INSERT INTO promotions (id,owner_id,listing_id,package_id,notes,status,amount,currency,created_at) VALUES ('p1','u-seller','11111111-1111-4111-8111-111111111111','reel','QA','quoted',500,'AED','2026-01-04T00:00:00.000Z');
INSERT INTO media (id,owner_id,listing_id,content_type,created_at) VALUES ('m1','u-seller','11111111-1111-4111-8111-111111111111','image/jpeg','2026-01-01T00:00:00.000Z');
INSERT INTO rate_limits (key,count,window) VALUES ('write:u-seller',3,490000);
INSERT INTO webhook_events (id,created_at) VALUES ('w1','2026-01-05T00:00:00.000Z');
INSERT INTO nomod_audit (id,order_id,type,outcome,created_at) VALUES ('a1','p1','quote','approved','2026-01-04T00:00:00.000Z');`;

rmSync(state, { recursive: true, force: true });
mkdirSync(preDir, { recursive: true });
try {
    if (exportFile) {
        console.log(`Importing ${exportFile} into an isolated local database…`);
        wrangler(['d1', 'execute', 'site-creator-d1', ...local('dist/server/wrangler.json'), '--file', exportFile, '--yes']);
    }
    else {
        for (const f of ['0000_optimal_carnage.sql', '0001_glossy_colleen_wing.sql'])
            writeFileSync(path.join(preDir, f), readFileSync(path.join('drizzle', f)));
        const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
        config.d1_databases[0].migrations_dir = path.resolve(preDir);
        writeFileSync(preConfig, JSON.stringify(config));
        wrangler(['d1', 'migrations', 'apply', 'site-creator-d1', ...local(preConfig)]);
        writeFileSync(path.join(state, 'sample.sql'), SAMPLE);
        wrangler(['d1', 'execute', 'site-creator-d1', ...local(preConfig), '--file', path.join(state, 'sample.sql'), '--yes']);
    }
    const before = snapshot();
    if (before.some(l => /^SCHEMA \w+ (idx_)?crm_/.test(l)))
        throw new Error('This database already has CRM tables. Stop: the migration may already be applied.');
    const pending = wrangler(['d1', 'migrations', 'list', 'site-creator-d1', ...local('dist/server/wrangler.json')]);
    const pendingNames = [...pending.matchAll(/(\d{4}_\w+\.sql)/g)].map(m => m[1]);
    console.log('Pending migrations:', pendingNames.join(', ') || 'none');
    if (pendingNames.length !== 1 || pendingNames[0] !== '0002_crm_phase1.sql')
        throw new Error('Expected exactly one pending migration (0002_crm_phase1.sql). Stop and reconcile the migration history before applying anything to production.');
    wrangler(['d1', 'migrations', 'apply', 'site-creator-d1', ...local('dist/server/wrangler.json')]);
    const after = snapshot();
    const afterSet = new Set(after), beforeSet = new Set(before);
    const removed = before.filter(l => !afterSet.has(l)), added = after.filter(l => !beforeSet.has(l));
    const unexpected = added.filter(l => !/^SCHEMA (table|index) (idx_)?crm_/.test(l) && !/^ROW crm_counters: /.test(l) && !/^ROW d1_migrations: .*"0002_crm_phase1\.sql"/.test(l));
    const again = wrangler(['d1', 'migrations', 'apply', 'site-creator-d1', ...local('dist/server/wrangler.json')]);
    const tables = (lines, prefix) => lines.filter(l => l.startsWith(prefix)).length;
    console.log(`Existing objects and rows before: ${before.length}; unchanged after: ${before.length - removed.length}`);
    console.log(`Added: ${tables(added, 'SCHEMA table')} tables, ${tables(added, 'SCHEMA index')} indexes, ${tables(added, 'ROW crm_counters')} counter rows, ${tables(added, 'ROW d1_migrations')} migration record`);
    if (removed.length)
        throw new Error('Existing data or schema changed:\n' + removed.slice(0, 20).join('\n'));
    if (unexpected.length)
        throw new Error('Unexpected additions:\n' + unexpected.slice(0, 20).join('\n'));
    if (tables(added, 'SCHEMA table') !== 7 || tables(added, 'ROW crm_counters') !== 3 || tables(added, 'ROW d1_migrations') !== 1)
        throw new Error('The migration did not add the expected 7 tables, 3 counter rows and 1 migration record.');
    if (!/No migrations to apply/.test(again))
        throw new Error('Re-running the migration was not a no-op.');
    console.log('PASS: existing marketplace schema, data and migration history are unchanged; only CRM objects were added; re-running is a no-op.');
}
catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
}
finally {
    rmSync(preConfig, { force: true });
    rmSync(state, { recursive: true, force: true });
}
