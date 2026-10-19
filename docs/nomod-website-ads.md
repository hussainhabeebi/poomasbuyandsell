# Website-ad-only Nomod checkout

Review baseline: `890d8108b3f351cc74b6bacfeb64eac5ea0f5143`.
Branch: `review/nomod-website-ads-only`.

## Confirmed scope

The client has confirmed that online payments are for advertisements on the website. Fixed packages, prices, durations, placements and cancellation/refund terms are still undecided. This change does not invent them, charge for ordinary listing submission, introduce banner products, or automatically feature any listing.

The existing `boost` (Marketplace Spotlight) identifier is the only website-ad request classification eligible for a future staff-approved online-payment quotation. Keeping that identifier preserves current requests and references; it does not approve the existing marketing description as an advertising contract. A final client-approved advertising offer and delivery workflow remain launch gates.

`story`, `reel` and `shoot` remain available as enquiries handled directly with the team. Unknown identifiers fail closed. They cannot receive a new online-payment quote, create a new Nomod link, or reopen an existing link through seller checkout. Historical amounts, verified payment status and event/audit history remain readable. Verified webhook events and authorized reconciliation still process existing liabilities across all package identifiers; the scope restriction must not strand a prior payment, refund or dispute.

## Technical changes

- One shared exact-match website-ad policy is used by the server and dashboard.
- Checkout checks eligibility before any provider call or payment-attempt reservation. The atomic creation reservation rechecks the package ID to prevent an intervening order change from authorizing a non-website link.
- The existing admin-only quote action applies the eligibility condition in its atomic SQL update. Ineligible requests retain their current amount/status and do not acquire an approval audit record. Existing amount parsing, staff attribution, currency rules and quote locking remain unchanged.
- The seller dashboard starts with checkout hidden. A read-only `GET /api/checkout` must return a successful JSON response with the exact boolean `paymentsEnabled: true` before a Pay button can appear. Errors, malformed JSON, missing fields, non-boolean values and aborted responses cannot enable checkout. The server remains authoritative even if client state is forged or stale.
- Only website-ad rows in `quoted` or `awaiting_payment` state can offer checkout. Busy submission protection and validated Nomod redirects are retained. Video/social rows offer neither Pay nor an online quote approval control. Admins do not fetch seller checkout availability.
- Payment creation, signed webhook verification, financial/provider matching, return-status ownership checks, duplicate-event protection, five-check recovery limit, 60-second cooldown and ten-event replay limit otherwise remain unchanged.
- Payment confirmation remains separate from ad fulfillment and ordinary listing moderation.

## Unchanged production safety

`NOMOD_RELEASE_APPROVED` remains `false`. Do not enable `NOMOD_PAYMENTS_ENABLED` as part of this work. No production credentials, provider requests, charges, synthetic production webhooks or D1/R2 writes are used. No migration, schema/history change, Cloudflare configuration change, queue, scheduler or new dependency is required. This branch is not a payment activation or advertising fulfillment release.

## Validation

Tests use mocked HTTP, in-memory SQLite, real API authorization handlers, server-rendered React controls and simulated hook effects. They cover:

- Rejection of non-website and unknown packages for new and stored-link checkout, with no provider calls or payment mutations.
- A package change between initial order read and atomic checkout reservation.
- Ineligible admin quotations and preserved video/social enquiries through the real market API.
- Historical non-website completion, duplicate delivery, refund, dispute and original-link recovery without creating another link.
- Disabled/initial checkout UI, website-only controls, pending/settled states, repeated submission and decimal display.
- Readiness failures, exact-boolean handling, abort/unmount safety and no readiness request for admins.
- Existing webhook matching, signature, idempotency, early events, timeout recovery, release locks, seller return, marketplace and listing regressions.

Validation result: all 131 automated tests passed, including 58 Nomod lifecycle tests and 11 payment-panel/readiness tests. TypeScript and the production build passed.

These are isolated tests, not physical-device or Nomod acceptance tests. No safe local authenticated browser preview or provider sandbox has been established for this branch. Browser interaction, mobile layout and real signed provider delivery remain unverified.

## Before customer payments

1. Client approves what a website ad buys: placement/product, duration, publication responsibility, amount approval, applicable tax treatment, cancellation/refund terms and what happens if an ad cannot be delivered. Choose normal listing fees, featuring, banners or another model explicitly; this branch does not assume one.
2. Implement and test that approved delivery/expiry workflow separately. Do not accept payment based on an amount alone while the advertising service is undefined. Existing request notes and amount audit records are not a structured advertising-contract or scheduling system.
3. Confirm current production D1 migrations, secret presence, exact HTTPS return origin and the Nomod API webhook subscriptions through authorized access, without revealing values or replaying migrations.
4. Obtain written Nomod confirmation of an isolated test environment/process, authorized test credentials and supported test cases. The public docs' API explorer sends live requests; a `.dev` URL or test-looking example key is not proof of sandbox authorization.
5. In that authorized isolated environment, test success, failure, cancellation, signature rejection, duplicate/early/out-of-order delivery, amount/reference/link mismatches, timeout adoption, refunds/disputes and seller/admin isolation. Confirm no payment alone publishes or fulfills an advertisement.
6. Review and approve the code and business workflow, then separately authorize deployment and payment activation. Both the source release lock and the environment enable switch must be deliberately reviewed; neither is changed here.
7. After separate authorization, observe the first controlled transaction and its unique order/link/charge/event/audit associations. If verification fails, disable new checkout, retain all attempts and payment history, and investigate with Nomod rather than creating replacement links or resetting locks. Refunds require separate authorization; disabling checkout does not refund existing payments.

Provider documentation checked on 19 October 2026 (documentation only, no API calls):

- https://nomod.com/docs/api-reference/introduction
- https://nomod.com/docs/api-reference/authentication
- https://nomod.com/docs/api-reference/requests-responses
- https://nomod.com/docs/api-reference/generate-link
- https://nomod.com/docs/webhooks/how-webhooks-work

No provider-approved sandbox entitlement or merchant-specific test process has been verified. Live customer payments remain blocked.
