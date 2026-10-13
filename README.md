# Poomas Buy & Sell

UAE marketplace for commercial properties and vehicles, with seller submissions, Ajeesh promotion requests, AI assistance and Nomod-hosted promotion checkout.

## Stack and development

React 19 / Vinext App Router, Cloudflare Workers, D1, R2, TypeScript. Run `pnpm install`, `pnpm dev`, `pnpm build`. The Sites build/publish workflow provisions logical `DB` and `BUCKET` bindings from `.openai/hosting.json` and applies Drizzle migrations before deployment.

The first release has no fabricated inventory, seller claims, inspection badges, testimonials or reach statistics. Home category photographs are editorial imagery, not listings. Sellers upload actual listing photos.

## Accounts and roles

Sign-in uses **Sign in with Google**. Public browsing needs no sign-in. Listing submissions, saved listings, enquiries, promotions and the seller dashboard require sign-in. `ADMIN_EMAILS` is a comma-separated server-side administrator allowlist (use the admins' Google email addresses). Ownership and administrator checks are enforced on each write.

`/signin?return_to=…` starts the Google authorization code flow (with state and PKCE). `/auth/google/callback` exchanges the code server-side, accepts only accounts with a verified email, and stores the account in an HttpOnly session cookie signed with `SESSION_SECRET` (30 days). `/signout` clears it. User IDs are the Google account `sub`, so listings created under earlier sign-in methods are not linked to the new accounts automatically.

Setup:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, then **APIs & Services → OAuth consent screen**: app name *Poomas Buy & Sell*, support email, audience **External**, and publish the app (**In production**).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URIs: `https://www.poomasbuyandsell.com/auth/google/callback` and `https://poomasbuyandsell.com/auth/google/callback` (plus any `*.workers.dev` URL you use).
3. Add Worker secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` (a long random string, e.g. `openssl rand -base64 32`). Changing `SESSION_SECRET` signs everyone out.

In `pnpm dev`, `/signin` signs in a local test user (`seedy@sites.test`) without Google. The smoke test sends local-only `x-poomas-dev-user-*` headers, which the Worker trusts only in the dev server, or with `AUTH_TRUST_LOCAL_HEADERS=true` on a loopback host — never set that variable in production.

## Runtime configuration

Configure through hosting environment settings; never commit secrets or place them in browser code.

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAILS` | Administrator email allowlist |
| `GOOGLE_CLIENT_ID` (secret) | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` (secret) | Google OAuth web client secret |
| `SESSION_SECRET` (secret) | Long random string that signs session cookies |
| `PAYMENT_RETURN_ORIGIN` | Exactly `https://www.poomasbuyandsell.com`, without a trailing slash |
| `NOMOD_PAYMENTS_ENABLED` | Default disabled; `true` is also required after separately approved release-lock removal |
| `NOMOD_API_KEY` (secret) | Verified merchant's general Nomod API key |
| `NOMOD_WEBHOOK_SECRET` (secret) | Nomod API webhook Svix signing secret |
| `OPENAI_API_KEY` (secret) | Enables real AI search and listing drafting |
| `OPENAI_MODEL` | Optional model name; default `gpt-4.1-mini` |

Ordinary filters and manual listing creation work without an AI key. AI requests fail clearly when unavailable rather than providing simulated AI responses. Prompts only include relevant public inventory and seller-provided text. Never upload confidential documents in an AI prompt.

## Seller and admin workflow

1. Seller uploads 1–8 JPG/PNG/WebP photos, completes property/vehicle details and submits.
2. Submission remains private with `pending` status. Owner and admin can access its media; public visitors cannot. Editing a pending, published or rejected listing resubmits it for review and temporarily removes it from public inventory.
3. Admin reviews details, photo gallery and optional video in `/admin`, and publishes or rejects.
4. Published listings appear in category search, standalone detail pages and sitemap. Sold listings remain accessible but are noindex and excluded from active inventory. Withdrawn/rejected/pending listings are not publicly accessible.
5. Buyers can save a listing, send enquiries, request viewings/test drives, discuss offers and open seller WhatsApp. Enquiries persist in buyer/seller dashboards. No external notification messages are sent automatically in this release.
6. Seller requests a promotion. Admin sets the confirmed AED quote. Payment requires a published listing. Package prices are not invented or hardcoded.

## Nomod integration

Official contracts: [Create Link](https://nomod.com/docs/api-reference/generate-link), [Get Link](https://nomod.com/docs/api-reference/retrieve-link), [List Charges](https://nomod.com/docs/api-reference/fetch-charges), [webhook events/payload](https://nomod.com/docs/webhooks/how-webhooks-work) and [signatures](https://nomod.com/docs/webhooks/verifying-webhook-signatures).

**This release cannot activate payments.** `NOMOD_RELEASE_APPROVED` is deliberately `false` in `lib/nomod.ts`. Configuration alone cannot override it. `GET /api/checkout` is a read-only, no-store probe returning `paymentsEnabled: false`. Checkout and reconciliation also require `NOMOD_PAYMENTS_ENABLED=true`, both secrets, the exact approved return origin and the additive payment schema. Never remove the release lock without separately approved merchant testing and activation.

The existing Payment Links integration creates one link from an authenticated seller's stored, approved quotation for a published listing. A unique permanent creation reservation is committed before the provider POST. The link note contains both the promotion UUID and an attempt UUID. All timeouts, non-OK responses, malformed/blocked link responses and save failures retain the reservation. No retry or reconciliation action creates a second link. Existing links are revalidated before returning their URLs. Return-page query parameters never mark an order paid.

Nomod's webhook example documents `eventId`, `objectId`, `data.id` (charge UUID), `referenceId`, `note`, `originalTotal`, `originalCurrency` and `status`; it does not document a webhook link ID. Signed events are journaled using allowlisted fields only. Before changing payment state, the server queries the documented `/v1/charges?id=<charge UUID>&link_id=<stored link UUID>` filter and requires an exact charge, reference, note, amount and currency match. Full provider bodies, customer details, card data and credentials are never stored. The first verified settlement binds a unique charge to the promotion/link; subsequent financial events must match that binding. Refund/dispute transitions are monotonic and cannot be overwritten by delayed completion or partial-refund events.

Subscribe to `charge.completed`, `charge.refunded`, `charge.partially_refunded`, `charge.dispute.created`, `charge.failed` and `charge.cancelled`; `charge.created` and `charge.authorised` are optionally supported for audit. Failed means declined authorisation/capture; cancelled means voided authorisation. Neither marks paid nor creates another link. Retry returns only the original still-enabled, unblocked link, consistent with Nomod's documented payment-count expiry. Confirm the merchant's payment-method retry behavior during authorized testing.

Early events remain `pending_link` and are replayed after link adoption. Provider outages remain `pending_provider`; release-locked events remain `pending_activation` without outbound requests or promotion updates. Pending processing is synchronous and bounded to 100 events per replay; there is no new cron/queue. An administrator can repeat reconciliation until the pending backlog is cleared. Without the migration, webhook returns 503 so the provider retries instead of falsely acknowledging an event that could not be saved.

### Authorized reconciliation and activation procedure

1. Inspect the existing Worker `poomasbuyandsell`, its current D1 binding and migration history. The GitHub deployment workflow does not apply migrations. Do not create another Worker/database or re-import migration `0000` into an initialized database.
2. Review/apply only additive migration `0001_glossy_colleen_wing.sql` under separately authorized database administration. It creates `nomod_attempts`, `nomod_events`, `nomod_payments` and `nomod_audit` plus indexes. It alters no existing tables or payment records. Do not activate before it is present.
3. Nomod Owner/Admin: Settings → Tools & customisations → Apps & APIs → Webhooks → Create webhook → **Nomod API** → select events → endpoint `https://www.poomasbuyandsell.com/api/nomod/webhook`. Store the signing secret only in the existing Worker's encrypted `NOMOD_WEBHOOK_SECRET`. Store the general API key only in `NOMOD_API_KEY`; never paste values into GitHub, shell arguments or logs. Registering webhooks begins delivery immediately.
4. Confirm sandbox availability and authorized test instructions directly with Nomod. The public API Explorer makes live requests; example test-key strings do not establish a sandbox. No real Nomod calls, links or charges were made by the automated tests.
5. Only after separately approved activation can an authenticated, allowlisted administrator POST `/api/nomod/reconcile` with same-origin JSON `{ "id": "<promotion UUID>", "linkId": "<original link UUID>" }`. Locate the original link in Nomod by the exact attempt note; recovery verifies its provider response before adoption. Disabled original links can be adopted for event processing but are never returned as payable checkout links. A saved link cannot be replaced. Omitting `linkId` replays pending events for an already-saved link. A provider lookup failure or no matching link never clears the reservation. Do not manually reset `creating_payment`; a legacy ambiguous attempt without an attempt record requires a separately reviewed recovery plan.
6. Before approving removal of the release lock, verify charge-filter semantics, refund/dispute payloads, original-vs-settlement currency behavior, merchant tax/markup configuration, retry behavior and actual signed delivery using Nomod's authorized test environment/process. Verify promotion fulfillment only after confirmed payment. This checkout collects promotion fees only, never property or vehicle sale funds.

## SEO

Canonical target: `https://www.poomasbuyandsell.com`. Server-rendered public pages, per-listing title and description, Open Graph text, semantic headings, sitemap with published listings, robots rules for private/API/filter routes, Organization, BreadcrumbList, Vehicle/Offer, RealEstateListing and Article structured data. Guide content is original and contextual; no fabricated reviews, ratings or local-business address. Sold listings are noindex; withdrawn listings 404. Stock category images have alt text and fixed dimensions. Mobile layouts, skip navigation and reduced motion are supported.

After DNS is active and public access is enabled: verify www/apex routing and redirects, submit sitemap in Google Search Console, add verified contact/legal entity details, set the official Instagram profile, publish accurate inventory, and measure Core Web Vitals and indexing. SEO implementation cannot guarantee rankings.

## Verification

`pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`, then `node scripts/smoke.mjs` after applying the local D1 migration. Automated checks cover publication/privacy, listing validation, payment reference/amount/currency and webhook signatures/replays. Local Worker HTTP smoke checks cover routes, metadata, sitemap, storage schema and anonymous API rejection. The HTTP smoke script checks 21 public routes/access/404 conditions and then exercises local uploads, review, save/enquiry, promotion quotes, unavailable-key checkout, listing edits and withdrawal using local-only QA identities. No real private user data, credentials or production listings are seeded by tests. The test submission is withdrawn on successful completion. Browser visual QA was unavailable in this session.

## Media credits

Home editorial category images sourced through Unsplash:
- Coralt Zou, Dubai glass architecture: https://unsplash.com/photos/i3N0m2omOEM
- Black SUV photo: https://unsplash.com/s/photos/black-suv (asset photo-1645791608306-6db92b84d498)

## Direct Cloudflare deployment

Worker name: `poomasbuyandsell`. Build with `pnpm exec vite build`; deploy with `pnpm exec wrangler deploy --config dist/server/wrangler.json`. D1 `DB` uses `site-creator-d1` and R2 `BUCKET` uses `site-creator-r2`, preserving the names from the initial deployment. When no D1 ID is supplied, Wrangler provisions/resolves the database instead of receiving a fabricated placeholder. To bind an existing database explicitly, set `CLOUDFLARE_D1_DATABASE_ID` to its actual UUID in the **build environment**, then rebuild. This is not a secret. Do not use the development placeholder UUID.

After provisioning, pin the real D1 UUID as that build variable. Apply the schema before using listings: `pnpm exec wrangler d1 migrations apply site-creator-d1 --remote --config dist/server/wrangler.json`. The generated configuration carries the `drizzle` migration directory. Migrations create schema, not sample listings; don't re-import an already-applied SQL file manually. For a database whose schema was previously applied outside Wrangler, reconcile migration history before applying it again.

Account sign-in requires the Google OAuth client and the `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` Worker secrets described under **Accounts and roles**.
