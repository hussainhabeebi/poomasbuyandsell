# Poomas business-for-sale CRM: Phase 1

Status: **implemented on branch `claude/tender-cori-k7p0ku` (PR #3, draft); not deployed and not migrated in production.** There is no staging environment: everything is tested locally, then deployed to production only with explicit approval.
Phase 2 (matching, follow-up tasks, contact history, dashboard and exports) has not been started.

## Scope

| Requirement | Where |
| --- | --- |
| Buyer records (BUY-0001), with all fields and statuses from the brief | `/admin/crm?tab=buyer` |
| Seller records (SEL-0001) | `/admin/crm?tab=seller` |
| Business listings (LST-0001), linked to a seller; one seller can have many listings | `/admin/crm?tab=listing` |
| Public Buyer and Seller enquiry forms, with Turnstile and consent; submissions create records automatically | `/enquiry/buyer`, `/enquiry/seller` |
| Manual entry of phone, WhatsApp, social media and referral enquiries | "New buyer" / "New seller" (choose the source) |
| Search by name, phone/WhatsApp, record ID, category, emirate/area, budget or asking price range, source, status, assigned staff and follow-up date | Search bar and Filters on each tab |
| Duplicate phone warning that links to the existing record; records are never merged automatically | Warning on phone blur and on save ("Save anyway as a separate record") |
| Roles: Administrator, Sales staff, Read-only | CRM → Team |
| Confidential documents (PDF/JPG/PNG, up to 10 MB), private in R2 | Seller or listing → Confidential documents (administrators only) |
| Audit trail of creates, updates, approvals, document uploads and downloads | Record → Change history (administrators only) |
| Only approved Active listings are public | `/businesses-for-sale` |

The existing property and vehicle marketplace is unchanged. CRM listings live in their own table and never appear in `/api/market`, `/properties`, `/vehicles` or the sitemap. Two small additions sit outside the CRM itself: a link to the CRM on `/admin`, and new README and `.env.example` entries.

## Permissions

| | Administrator | Sales staff | Read-only |
| --- | --- | --- | --- |
| View normal buyer, seller and listing fields | ✅ | ✅ | ✅ |
| Buyer phone and email | ✅ | ✅ | ❌ |
| Seller phone and email | ✅ | ❌ (can enter at creation; cannot view or change afterwards) | ❌ |
| Financial details (seller estimated profit; listing operating costs and estimated profit) | ✅ | ❌ (can enter at creation only) | ❌ |
| Internal notes | ✅ | ❌ | ❌ |
| Confidential documents | ✅ | ❌ | ❌ |
| Create and edit records | ✅ | ✅ | ❌ |
| Approve a listing as Active, or change an Active listing's public details | ✅ | ❌ | ❌ |
| Manage team and view change history | ✅ | ❌ | ❌ |

Asking price and monthly rent are treated as normal listing details, because they are shown publicly once a listing is approved. To change which fields count as sensitive, edit `SENSITIVE_FIELDS` and `SENSITIVE_ACCESS` in `lib/crm/permissions.ts`; the server, the redaction step and the tests all read from there.

Restricted fields are removed on the server before any response is sent, so they never reach the browser. Every API call re-checks the user's role.

**Listing visibility rule:** a listing is public only when all of these hold: status = Active, document verification = Verified, authorization = Authorized, and an administrator approved it (`approved_at` is set). Only an administrator can set Active, and only when the seller is "Owner verified" or "Authorized representative verified". Moving a listing to Reserved, Under Negotiation, Sold, Withdrawn or Draft removes it from public view and clears the approval. Returning it to Active needs a fresh administrator approval.

## How access works

Sign-in uses the existing Google login. Everyone in `ADMIN_EMAILS` is a CRM administrator. Other staff need an active row in `crm_staff`, which an administrator adds under CRM → Team using the person's exact Google email address. Disabling a team member removes their access on their next request.

## Database migration review

`drizzle/0002_crm_phase1.sql` contains 32 statements:
- **7 × `CREATE TABLE`:** `crm_audit`, `crm_buyers`, `crm_counters`, `crm_documents`, `crm_listings`, `crm_sellers`, `crm_staff`.
- **23 × `CREATE INDEX`:** 3 unique indexes for the record codes and 20 indexes for search.
- **1 × `INSERT OR IGNORE`:** seeds the three record-number counters.

It contains no `ALTER`, `DROP`, `UPDATE`, `DELETE`, `RENAME` or `REPLACE`. No statement names an existing table, and no new table or index name clashes with an existing one. The only foreign key points from `crm_listings` to `crm_sellers`; no existing table gains a foreign key. Wrangler applies the file as a single migration and records it in `d1_migrations`.

How this has been checked:

| Check | Result |
| --- | --- |
| `test/crm-migration.test.ts` (runs with `pnpm test`) | The file contains only `crm_` objects and no destructive statements. After applying it on top of 0000 and 0001 with marketplace data present, existing tables, indexes and rows are identical. |
| `node scripts/crm-migration-check.mjs`: a local rehearsal of the production upgrade using Wrangler's own `d1 migrations apply` | Before: 36 existing objects and rows, including listings, saved items, enquiries, promotions, media, rate limits, webhook events, Nomod audit and the 0000/0001 history. After: all 36 unchanged. Added: 7 tables, 23 indexes, 3 counter rows and 1 migration record. Re-running reports "No migrations to apply". |
| The same script with `--from-export <file>`, using a dump in the same format as `wrangler d1 export` | Passes. With a dump that lacks migration history, it **stops** and asks for the history to be reconciled, which is the protection needed if production's history doesn't match. |
| New code against a database **without** the migration | The whole marketplace works: home, properties, vehicles, listing pages, `/api/market`, sitemap, seller dashboard and admin review. CRM pages show "temporarily unavailable" and the CRM API returns 503, so nothing is written. |
| New code against the migrated database | Everything above still works, and the CRM works. |

Because the change only adds tables, the order of migration and deployment doesn't matter for the existing site. The safe order is still **migrate first, then deploy**, so the CRM works the moment the new code goes live.

## Local testing (complete)

Run from the repository root on this branch:

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm build
```

```bash
pnpm smoke:crm
```

```bash
pnpm check:crm-migration
```

| Check | Result |
| --- | --- |
| Type check | Pass |
| `pnpm test` | 156/156 pass, including 32 CRM tests on SQLite with the real migration files |
| `pnpm build` | Pass |
| `pnpm smoke:crm` | 44 HTTP checks pass against a local Worker and an isolated local database: sign-in, roles, hidden fields, duplicate warning, approval and public visibility, documents, cross-origin rejection, spam trap, Turnstile failing closed |
| `scripts/crm-migration-check.mjs` | Pass, in both sample mode and export mode, as described above |
| Existing `scripts/smoke.mjs` | The marketplace flow passes: 21 HTTP checks plus upload, moderation, save, enquiry, promotion quote and withdrawal. Its 404 step hangs in a freshly started local dev server **on `main` too**. The 404 routes themselves respond correctly (404 in under 50 ms) on a running local Worker. |
| Browser check (Playwright, desktop and iPhone 13, admin and sales) | No horizontal scrolling and no page errors |
| `pnpm lint` | New files clean; the 27 issues reported are the same as on `main` |

**Cannot be tested locally:** a successful Turnstile verification. Cloudflare's verification service isn't reachable from the development sandbox. Rejection without a valid token is tested; the first successful live submission is part of the post-deployment checks below.

## Production configuration

Worker: `poomasbuyandsell`. D1 binding `DB` → database `site-creator-d1`. R2 binding `BUCKET` → bucket `site-creator-r2`.

| Name | Type | Status | Purpose |
| --- | --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | Worker secret | **New, required** | Server-side Turnstile check. Without it, the public forms refuse all submissions. |
| `TURNSTILE_SITE_KEY` | Worker secret (it isn't confidential) | **New, required** | Shown in the public forms. Set it as a secret so `wrangler deploy` doesn't remove it (see the note below). |
| `ADMIN_EMAILS` | existing | Required, unchanged | Marketplace administrators, who also become CRM administrators |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` | existing secrets | Required, unchanged | Google sign-in, used by the CRM too. No new redirect URIs are needed. |
| `PAYMENT_RETURN_ORIGIN` | var in the built `wrangler.json` | Unchanged | |
| `NOMOD_*`, `OPENAI_API_KEY`, `OPENAI_MODEL` | existing, optional | Unchanged | Not used by the CRM |
| `AUTH_TRUST_LOCAL_HEADERS` | — | **Must not be set** | For local testing only |
| `DB`, `BUCKET` | bindings | Unchanged | The CRM uses new tables in the same database and the `crm-documents/` prefix in the same bucket |
| GitHub Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (secrets), `CLOUDFLARE_D1_DATABASE_ID` (variable) | existing | `CLOUDFLARE_D1_DATABASE_ID` should be set to the real UUID | Used by the deploy workflow |

**Why both Turnstile keys are secrets:** `wrangler deploy` replaces dashboard *variables* with those in the built config, unless `keep_vars` is set. Secrets survive deploys.

## Production deployment checklist

Every step that writes to production is marked **APPROVAL**. Nothing is applied, deployed or merged without the owner's explicit go-ahead.

Run everything from a clean checkout of this branch on a trusted administrator machine. You need a Cloudflare API token with D1 Edit and Workers Scripts Edit for the Poomas account (`wrangler login` also works).

### A. Pre-flight (read-only)

1. **Confirm the Cloudflare account:**

   ```bash
   pnpm exec wrangler whoami
   ```

2. **Find the database and its UUID.** Note the UUID, size and plan:

   ```bash
   pnpm exec wrangler d1 list
   ```

   ```bash
   pnpm exec wrangler d1 info site-creator-d1
   ```

3. **Confirm the live Worker uses that database.** In the dashboard, go to Workers & Pages → `poomasbuyandsell` → Settings → Bindings, and check that `DB` points to `site-creator-d1` and `BUCKET` to `site-creator-r2`.

4. **Build with the database ID pinned:**

   ```bash
   export CLOUDFLARE_D1_DATABASE_ID=<uuid from step 2>
   ```

   ```bash
   pnpm install --frozen-lockfile && pnpm build
   ```

5. **Check migration history.** The only pending migration must be `0002_crm_phase1.sql`. If 0000 or 0001 show as pending, **stop**: the history doesn't match the schema.

   ```bash
   pnpm exec wrangler d1 migrations list site-creator-d1 --remote --config dist/server/wrangler.json
   ```

6. **Confirm there are no CRM tables yet.** The result must be empty:

   ```bash
   pnpm exec wrangler d1 execute site-creator-d1 --remote --config dist/server/wrangler.json --command "SELECT name FROM sqlite_master WHERE name LIKE 'crm_%' OR name LIKE 'idx_crm_%'"
   ```

7. **Record the marketplace row counts** so you can compare them after the migration:

   ```bash
   pnpm exec wrangler d1 execute site-creator-d1 --remote --config dist/server/wrangler.json --command "SELECT (SELECT COUNT(*) FROM listings) AS listings,(SELECT COUNT(*) FROM saved) AS saved,(SELECT COUNT(*) FROM enquiries) AS enquiries,(SELECT COUNT(*) FROM promotions) AS promotions,(SELECT COUNT(*) FROM media) AS media"
   ```

8. **Check the Worker's secrets.** Confirm the required secrets exist and `AUTH_TRUST_LOCAL_HEADERS` is not set. This lists names only, never values:

   ```bash
   pnpm exec wrangler secret list --name poomasbuyandsell
   ```

9. **Run the local checks:**

   ```bash
   pnpm test && pnpm smoke:crm && node scripts/crm-migration-check.mjs
   ```

### B. Backups (immediately before the migration)

1. **Record a Time Travel restore point.** Write down the bookmark and the UTC time. Time Travel keeps 30 days of history on Workers Paid and 7 days on Free:

   ```bash
   pnpm exec wrangler d1 time-travel info site-creator-d1 --config dist/server/wrangler.json
   ```

2. **Take a full SQL export.** Large exports can briefly hold up other requests to the database; Poomas's database is small. The file contains personal data: store it encrypted, outside the repository, and never commit or email it.

   ```bash
   pnpm exec wrangler d1 export site-creator-d1 --remote --config dist/server/wrangler.json --output=poomas-d1-before-crm-$(date -u +%Y%m%dT%H%MZ).sql
   ```

3. **Verify the export.** The file must be non-empty and contain `CREATE TABLE` and `INSERT INTO` lines for `listings` and `d1_migrations`. Then rehearse the migration on it locally; it must print PASS. The script deletes its local copy afterwards.

   ```bash
   node scripts/crm-migration-check.mjs --from-export <export file>
   ```

4. **R2:** the migration doesn't touch R2 and no CRM documents exist yet, so no R2 backup is needed for this change.

### C. Turnstile configuration (APPROVAL: creates config on the live Worker)

1. **Create the widget.** In the Cloudflare dashboard, go to Turnstile → Add widget. Hostnames: `www.poomasbuyandsell.com` and `poomasbuyandsell.com`. Mode: Managed.

2. **Store both keys as secrets.** Each command prompts for the value; never put a key in a command line, the repository or chat. Old code ignores these keys.

   ```bash
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --name poomasbuyandsell
   ```

   ```bash
   pnpm exec wrangler secret put TURNSTILE_SITE_KEY --name poomasbuyandsell
   ```

### D. Migration (APPROVAL)

1. **Apply the migration** and confirm the prompt:

   ```bash
   pnpm exec wrangler d1 migrations apply site-creator-d1 --remote --config dist/server/wrangler.json
   ```

2. **Verify.** Re-run A5: there should be no pending migrations. Re-run A6: the 7 `crm_` tables and 23 `crm_` indexes should be listed. Re-run A7: the counts should be identical. The live site keeps running the old code, which ignores the new tables.

### E. Deploy (APPROVAL)

1. **Check the GitHub setting.** Confirm the repository variable `CLOUDFLARE_D1_DATABASE_ID` equals the UUID from A2 (Settings → Secrets and variables → Actions → Variables).
2. **Merge.** Mark PR #3 *Ready for review*, then merge it. The merge to `main` runs `.github/workflows/deploy.yml`, which builds and runs `wrangler deploy`. The workflow doesn't run migrations; that was done in D.
3. **Watch the run.** Follow the GitHub Actions run until it succeeds.

### F. Post-deployment checks (production)

1. **Existing site:** confirm `/`, `/properties`, `/vehicles`, a published listing page, `/sell` and `/admin` work as before.
2. **CRM:** sign in at `/admin/crm` as an `ADMIN_EMAILS` account. The overview should load with zero records.
3. **Team:** add the sales and read-only staff under CRM → Team. Sign in as a sales user and confirm that seller phone, email, profit and internal notes show as Restricted.
4. **Public forms:** submit `/enquiry/buyer` once with a real phone number, name it "TEST – Poomas", and check that a BUY- record appears with source Website. CRM records can't be deleted, so set the test record's status to Lost and note it in its internal notes. Repeat for `/enquiry/seller`.
5. **Public listings:** `/businesses-for-sale` should show "No businesses listed right now" until an administrator approves a listing.

### Rollback

- **Code** (fast, no data loss): revert the merge commit on `main` with a pull request, which redeploys the previous version. Alternatively, roll back to the previous version immediately:

  ```bash
  pnpm exec wrangler rollback --name poomasbuyandsell
  ```

  The CRM tables can stay; the old code ignores them.
- **Remove only the CRM** (deletes CRM data permanently, so export first):

  ```sql
  DROP TABLE crm_audit; DROP TABLE crm_documents; DROP TABLE crm_listings; DROP TABLE crm_sellers; DROP TABLE crm_buyers; DROP TABLE crm_counters; DROP TABLE crm_staff;
  DELETE FROM d1_migrations WHERE name = '0002_crm_phase1.sql';
  ```

  Run it with `wrangler d1 execute site-creator-d1 --remote --command "…"`. Dropping a table also drops its indexes.
- **Full database restore** (last resort; it also discards marketplace changes made after the bookmark):

  ```bash
  pnpm exec wrangler d1 time-travel restore site-creator-d1 --config dist/server/wrangler.json --bookmark=<bookmark from B1>
  ```

  If the restore window has passed, import the B2 export into a new database instead.
