# Poomas business-for-sale CRM: Phase 1

Status: **implemented on branch `claude/tender-cori-k7p0ku`; not deployed and not migrated in production.**
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

## Database migration

`drizzle/0002_crm_phase1.sql` is additive only:
- It creates seven new tables: `crm_staff`, `crm_counters`, `crm_buyers`, `crm_sellers`, `crm_listings`, `crm_documents` and `crm_audit`, plus their indexes.
- It seeds three counter rows with `INSERT OR IGNORE`.
- It contains no `ALTER`, `DROP`, `UPDATE` or `DELETE`, and it does not reference any existing table. `test/crm-migration.test.ts` enforces this, and also checks that existing marketplace rows and schema are byte-identical after the migration runs.

### Before applying anywhere other than local

**Production (read-only checks; nothing has been run against production)**

A Cloudflare account administrator should run these with a token that can read D1:

```bash
pnpm exec wrangler d1 list
```

```bash
pnpm exec wrangler d1 info site-creator-d1
```

```bash
pnpm exec wrangler d1 migrations list site-creator-d1 --remote --config dist/server/wrangler.json
```

Expected result: `0000` and `0001` are applied and `0002_crm_phase1.sql` is the only pending migration. If `0000` or `0001` show as pending even though the tables exist, the migration history differs from the schema. **Stop** and reconcile it first (see the README's Nomod section). Do not re-run `0000`.

**Backup arrangements to confirm:**
1. **D1 Time Travel.** It is built into D1 and lets you restore to any minute in the last 30 days on the Workers Paid plan (7 days on Free). Check the plan, then record a bookmark immediately before migrating:

   ```bash
   pnpm exec wrangler d1 time-travel info site-creator-d1
   ```

2. **Full export before migrating.** Store the file securely outside the repository, because it contains personal data:

   ```bash
   pnpm exec wrangler d1 export site-creator-d1 --remote --output=poomas-d1-before-crm.sql
   ```

3. **R2.** R2 has no built-in point-in-time restore. CRM documents are stored under the `crm-documents/` prefix in the existing `site-creator-r2` bucket. Phase 2 can add a scheduled backup if required.

The repository currently has **no automated backups**. The GitHub deploy workflow builds and deploys only; it does not run migrations or backups.

### Applying (only after explicit approval)

```bash
pnpm exec wrangler d1 migrations apply site-creator-d1 --remote --config dist/server/wrangler.json
```

### Rollback

1. **Code only:** redeploy the previous commit. The new tables are unused by the existing site, so leaving them in place is harmless.
2. **Restore the whole database to before the migration:**

   ```bash
   pnpm exec wrangler d1 time-travel restore site-creator-d1 --bookmark=<bookmark recorded before migrating>
   ```

   This also discards any marketplace changes made after the bookmark.
3. **Remove only the CRM tables, keeping all other data.** This permanently deletes CRM data, so export first:

   ```sql
   DROP TABLE crm_audit; DROP TABLE crm_documents; DROP TABLE crm_listings; DROP TABLE crm_sellers; DROP TABLE crm_buyers; DROP TABLE crm_counters; DROP TABLE crm_staff;
   DELETE FROM d1_migrations WHERE name = '0002_crm_phase1.sql';
   ```

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Worker variable | Create a Turnstile widget in the Cloudflare dashboard for the staging or production hostname. The site key is public. |
| `TURNSTILE_SECRET_KEY` | Worker **secret** | Without it, the public forms show "temporarily unavailable" and reject submissions (fail closed). |
| `ADMIN_EMAILS` | existing | These users become CRM administrators. |

Never set `AUTH_TRUST_LOCAL_HEADERS` on staging or production.

## Staging instructions

The aim is a separate Worker and database so production is untouched.

1. **Create staging resources.** Create a staging D1 database and an R2 bucket. For example:

   ```bash
   pnpm exec wrangler d1 create poomas-staging
   ```

   ```bash
   pnpm exec wrangler r2 bucket create poomas-staging
   ```

2. **Build a staging config.** Run `pnpm build`, then copy `dist/server/wrangler.json` to a staging config and change three things: `name` to `poomasbuyandsell-staging`, the D1 `database_name`/`database_id` to the staging database, and the R2 `bucket_name` to the staging bucket. Do not reuse the production names.

3. **Apply migrations to the staging database only:**

   ```bash
   pnpm exec wrangler d1 migrations apply poomas-staging --remote --config <staging config>
   ```

4. **Set staging variables and secrets:** `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and `TURNSTILE_SECRET_KEY` (secrets), plus `TURNSTILE_SITE_KEY`. Add the staging callback URL (`https://<staging host>/auth/google/callback`) to the Google OAuth client.

5. **Deploy:**

   ```bash
   pnpm exec wrangler deploy --config <staging config>
   ```

6. **Acceptance walk-through:**
   1. Sign in as an admin and add a sales user and a read-only user.
   2. Submit both public forms. The records should appear with source Website and status New.
   3. Create a buyer with a phone number that already exists. You should see the duplicate warning with a link.
   4. As sales staff, confirm seller phone, email, estimated profit and internal notes show as Restricted.
   5. Create a listing, verify the seller, approve the listing as an admin, and confirm it appears at `/businesses-for-sale`.
   6. Set the listing to Reserved and confirm it disappears.
   7. Upload and download a document as an admin, and confirm sales staff cannot.
   8. Check everything on a phone and a desktop.
   9. Confirm `/properties`, `/vehicles`, `/sell` and `/admin` behave exactly as before.

## Automated checks

```bash
pnpm test
```

Runs unit and integration tests against real SQLite with the real migrations.

```bash
pnpm build && pnpm smoke:crm
```

Starts a local Worker with an isolated local database and makes more than 40 HTTP checks of authentication, roles, redaction, approval and documents. The final live Turnstile step needs outbound access to challenges.cloudflare.com; without it, the test only confirms the form fails closed.

```bash
node scripts/smoke.mjs
```

The existing marketplace smoke test.
