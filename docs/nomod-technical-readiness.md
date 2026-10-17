# Nomod technical readiness review

Base: main `050c35918c3515229a9ba3d6780c7224accd75f0`.
Review branch: `review/nomod-technical-readiness`.

This is a review-only implementation. Do not merge, deploy, run remote migrations, configure secrets or activate payments as part of this review. `NOMOD_RELEASE_APPROVED` remains `false`; `NOMOD_PAYMENTS_ENABLED` has not been enabled. No real Nomod API requests or customer payment tests were made.

## Selective port

Relevant return/recovery functionality was ported from `review/nomod-return-recovery` (`38c4bf64967b33b8673c08aa0a07f2f0d724bbf4`). The old branch was not merged. Its obsolete marketplace/navigation code was not copied. The current URL subscription, browser-history fix, vehicle validation and listing-price formatter are preserved. Two existing test harnesses were updated only to resolve the newly imported payment modules/CSS.

## Order and quote approval

The existing package identifiers remain request classifications; this change introduces no package names, prices, durations or advertising commitments. Requests have status `requested` and no payable amount. Seller-supplied `amount` fields are ignored. A verified administrator from the existing allowlist must use the existing quote action to approve an order-specific AED amount. The existing ceiling of AED 100,000 is preserved. Decimal parsing rejects exponent notation, negatives, zero and fractions below one fils.

Approval and its staff-ID/amount/timestamp audit record are atomic. Quotes cannot be changed once any checkout attempt has been reserved, even if an inconsistent legacy order still says `quoted`. Existing quoted records are preserved; the migration does not retrospectively invent approval records. Future approvals are audited in the existing `nomod_audit` table. Sellers never provide the amount sent to Nomod; checkout reads the approved database quotation.

Approved AED amounts display two decimals in payment rows and the return panel. Listing amounts and the general catalogue formatter are unchanged. Paid/refunded/disputed labels need a matching stored payment binding; inconsistent legacy rows show “Payment needs review.” General dashboards still load when payment tables are absent, with verification false; payment operations fail closed.

## Seller return

New success and failure URLs include the order UUID. These and session storage are navigation hints only. The read-only authenticated status endpoint scopes the order to its owner and reads saved verification records. Return hints survive sign-in through an allowlisted relative account return path. The panel checks at most six times, five seconds apart, with explicit refresh after that; it does not call Nomod, change payment state or generate a link. Checkout has a synchronous duplicate-click guard and validates the HTTPS Nomod destination before redirecting.

## Webhooks and recovery

Existing raw-body Svix HMAC verification, timestamp window, provider event-ID deduplication, financial/reference checks and provider charge/link matching remain in place. All eight documented API charge events remain supported. Completion is a payment status, not fulfillment. Refunds/disputes cannot be reversed by delayed completion.

Verified early/disabled events stay in `nomod_events`. Missing or temporarily unlisted provider charges remain pending rather than being discarded. Provider verification uses a durable atomic audit reservation: at most five checks per event, at least 60 seconds apart. A crash consumes a check. Replay selects at most ten eligible events per order, excluding cooling-down/exhausted events. No background cron, extra Cloudflare binding, queue or migration is introduced: the existing checkout/webhook paths try eligible events and authenticated operators explicitly replay unresolved work.

Admin → Promotions provides a private, read-only recovery overview even while payments are disabled. It shows pending/rejected events, charge/link/reference identifiers, check counts, last check times, ambiguous original creation attempts, recent processed events and quote approvals. Read/replay endpoints enforce the existing administrator allowlist; POST also requires same-origin, rate limits and enabled payment configuration. Replay/adoption cannot run while release-locked.

For ambiguous creation, an authorized operator locates the original attempt in Nomod and supplies that original link UUID for verification/adoption. Recovery never issues POST /links, clears an attempt lock, resets a retry budget, changes the approved amount or manually asserts paid. If no original link can be established, or the five-check budget is exhausted, stop and investigate with Nomod. A missing search result does not authorize another payment link. Event outcomes and financial transitions are audited transactionally and correlate back to the event row's provider identifiers. Only allowlisted metadata is stored, never raw payloads, card data or provider error bodies.

Each provider call retains a ten-second timeout. A ten-event replay can take approximately 100 seconds plus database overhead. Operators should inspect outcomes after a client timeout instead of assuming nothing happened. Resolved rows leave the pending list; return to page one after a batch. Recent history/approval lists intentionally show only the latest twenty entries; they are an operational summary, not a full audit export.

## Advertising fulfillment remains separate

No package is automatically delivered or listing featured after payment. The existing schema has no approved scheduling/fulfillment workflow. Client decisions remain necessary for scope, deliverables, price, VAT treatment, duration, publication approvals, cancellation/refund rules and responsible staff. Marketplace placement needs an approved placement/expiry policy; Instagram/reel/shoot services need separate content approval, scheduling and delivery evidence. No invented workflow or duration is implemented here.

## Provider documentation and safe testing

Reviewed on 17 October 2026:

- https://nomod.com/docs/api-reference/introduction — the API explorer sends live requests.
- https://nomod.com/docs/api-reference/generate-link — existing Payment Links API.
- https://nomod.com/docs/api-reference/fetch-charges — documented `id` and `link_id` filters and charge identifiers/amount/currency.
- https://nomod.com/docs/webhooks/how-webhooks-work — API versus Hosted Checkout webhooks and the eight charge events.

No safe sandbox, merchant test credentials or authorized provider test process was established. The `api.nomod.dev` example and test-looking key examples in documentation are not permission to use a test environment. Obtain written Nomod confirmation of an isolated test environment and matching API/webhook credentials first. Do not use the live API explorer or assume invented test cards are safe.

Validation uses mock HTTP and SQLite in memory, including actual route authorization, checkout creation locking, early/duplicate/mismatched/out-of-order events, refund/dispute monotonicity, timeout adoption, transient charge-list absence, bounded concurrent replay, staff quote auditing/rollback, custom-amount checkout, seller data isolation and release-disabled routes. No production test event is sent.

## Remaining release gates

1. Review and approve this branch, then authorize a separate deployment. No new migration or Cloudflare configuration is required by these changes; existing migrations/history are unchanged.
2. Verify the already-reported production payment tables, secrets, approved HTTPS origin and Nomod API webhook event subscriptions through authorized access. Their actual current production state was not re-read or changed here.
3. Confirm business scope/pricing and staff fulfillment/refund workflows before requesting live customer payments.
4. Obtain provider-approved isolated test facilities; run a separate authorized end-to-end checkout/webhook acceptance exercise. Mock success is not proof of provider acceptance.
5. Separately approve the release-lock change and enabling the environment switch only after all checks pass. No alternate activation endpoint exists.
6. Monitor the first separately authorized transaction and its unique event/payment/audit binding. If a problem occurs, disable new checkout, keep existing attempts/payments intact, investigate pending events and coordinate with Nomod. Disabling verification queues signed events for later controlled replay; it does not erase or refund payments.

## Local validation result

All 113 automated tests passed. TypeScript (`pnpm exec tsc --noEmit`) and the production build (`pnpm exec vite build`) passed. Build output retains the existing Vinext ineffective-dynamic-import warnings. These tests use mocks/fixtures only. This review did not perform browser interaction against an isolated payment preview or provider sandbox; those acceptance checks remain required before activation.
