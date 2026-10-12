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
| `PAYMENT_RETURN_ORIGIN` | Actual published HTTPS origin for Nomod return pages |
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

Source: https://nomod.com/docs/api-reference/generate-link and https://nomod.com/docs/webhooks/verifying-webhook-signatures

Server creates a one-payment Nomod Link (`POST /v1/links`, `X-API-KEY`) from the stored quote, not a client amount. The link includes the immutable request identifier in its note. Configure a **Nomod API** webhook at `https://www.poomasbuyandsell.com/api/nomod/webhook` after the domain routes correctly; use the published origin before that.

Subscribe to charge.completed, charge.refunded, charge.partially_refunded and charge.dispute.created. Webhook verifies raw-body Svix HMAC signature, five-minute timestamp, deduplicates event IDs and checks the promotion reference, amount, currency and payment state before setting paid. Redirects never mark an order paid. Refund and dispute state are not overwritten by delayed completed events. A payment-creation lock prevents duplicate checkout. Ambiguous provider/network failures are held in `creating_payment` for merchant reconciliation, rather than automatically creating another charge link. The merchant must reconcile those manually in Nomod; this release intentionally does not offer an unsafe automatic reset.

**Live merchant integration is not verified until credentials are configured and an end-to-end merchant-approved transaction and webhook delivery succeed.** Confirm merchant tax/markup settings and that the charge event preserves the link note and expected original total. No payments were created or charged during development. No property or vehicle sale funds are collected; checkout covers promotion only.

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
