# Nomod return, recovery and fulfillment review

Review only. `NOMOD_RELEASE_APPROVED` remains false. This branch must not activate payments or run migrations. No migration is required by these changes; migrations 0000 and 0001 are unchanged.

## Seller return

New payment links identify the promotion in both return URLs. The identifier and `payment` query value are navigation hints, not financial evidence. The authenticated status endpoint scopes every query to the owner and exposes only the package, listing title, quote and stored status. A paid/refunded/disputed label requires the existing uniquely bound payment record. An inconsistent legacy paid row is shown as needing review.

The account opens Promotions after return. It checks saved status at most six times, five seconds apart, and offers a manual refresh. It does not call Nomod or write payment state. A session-storage hint supports older links opened in the same tab; if neither hint exists, the seller sees guidance to select their promotion. Return hints survive sign-in without preserving arbitrary query parameters.

## Operator recovery

Admin → Promotions includes a read-only recovery panel with pending/rejected events and ambiguous checkout attempts. Its GET endpoint requires the existing administrator allowlist and returns private, no-store data. It paginates each list in stable oldest-first batches of 50; refresh from page one after resolving a batch because resolved rows leave the queue.

A reconciliation POST keeps the existing same-origin, authenticated-admin and hourly rate-limit guards. It requires normal payment configuration and release approval, so the current release permits inspection only. No new provider link can be created by recovery.

Every charge verification is reserved atomically in `nomod_audit` before contacting Nomod: type `provider_verification`, outcome equal to the provider event UUID. The event UUID is non-sensitive correlation metadata. Maximum five provider checks per event, at least 60 seconds apart. Crashes consume a check. Concurrent deliveries and operators share this persisted budget. Credentials-disabled and pending-link events consume no provider checks. Exhausted events remain durable and visible; operators cannot reset their budget through the UI/API.

Each replay examines at most ten eligible events for one order. Cooling-down and exhausted events are excluded so they do not starve later events. Provider calls retain the ten-second timeout. A pass can therefore take up to approximately 100 seconds plus storage overhead; keep the operator page open and inspect outcomes after completion. A completed HTTP response does not mean every event settled.

### Runbook after separately approved activation

1. Inspect the order, exact event ID/outcome and budget. Confirm the original quote and published listing. Do not edit financial rows manually.
2. For an ambiguous checkout, locate the original link in Nomod using the exact order/attempt note. Enter its UUID in the panel. Adoption checks its existing provider data and cannot replace a saved link. If no link can be proved, escalate; absence from search is not permission to create a replacement.
3. Replay eligible pending events for that order. Refresh and confirm each event's resulting outcome. Repeat after cooldown, within the lifetime budget. Refund/dispute state is never restored to paid by replay.
4. Rejected matches require investigation. Exhaustion requires engineering/provider review and an explicit recovery decision; there is no override/reset endpoint. A completely missing webhook requires Nomod's authenticated redelivery process, not a fabricated completion event or manual paid update.
5. Review the queue at an agreed cadence, particularly after provider outages. There is no new cron, queue or background worker. Assign an owner and response time before launch.
6. If stopping new checkout, disable the payment enablement variable through an authorized administrator. Existing paid links may still be payable; review them with Nomod. Signed events remain journaled while disabled. Do not restore D1 or erase attempts as routine rollback.

## Package-specific fulfillment proposal — not implemented

Payment verification and service delivery are separate. The current app records paid status but has no fulfillment ledger, duration, delivery proof or package-specific activation workflow. This branch does not feature listings, publish social media, book shoots or mark services delivered.

| Package | Safest proposed fulfillment | Business approval needed |
| --- | --- | --- |
| Marketplace Spotlight | Separate entitlement tied to a verified paid order and eligible published listing. Operator-approved start/end times; deterministic placement; suspend on refund/dispute or listing withdrawal. Initial launch can be manually scheduled until entitlement logic is approved and tested. | Duration, placement/rotation, capacity, start trigger, partial-refund policy, interruptions and listing edits. |
| Instagram Story | Staff scheduling and content approval, then manual publication through the approved account; save publication URL/time and agreed evidence. Payment alone must not publish content. | Account owner, editorial approval, publication window, revisions, disclosure requirements and cancellation/refund terms. |
| The Ajeesh Reel | Staff-owned brief → script/content approval → presenter/production schedule → final approval → publication and evidence. | Presenter availability, scope, revisions, deadlines, rights/consents and cancellation milestones. |
| Shoot + Promote | Coordinate shoot availability/location/permissions; approve deliverables; complete filming/editing approvals; track each social/marketplace deliverable separately. | Travel area, slots, duration, rescheduling/no-show policy, deliverables and partial completion/refund handling. |

Suggested future fulfillment ledger: one record per ordered deliverable, linked to the promotion; explicit states such as awaiting scheduling, scheduled, in progress, delivered, on hold and cancelled; actor/time audit and evidence. It must not overload payment status. Design and approve this separately before introducing any additive migration or automatic fulfillment.

## Required before launch

- Approve the package workflows above and an operator recovery owner/cadence.
- Confirm Nomod's authorized testing facility and exact merchant behavior for charge filters, currencies, fees, refunds/disputes and failed-attempt retries.
- Test real signed deliveries only through the provider-approved test process; no synthetic events to production.
- Validate authenticated seller/admin UI on desktop and mobile, including sign-in after checkout and older links.
- Review exhausted-event handling; test provider-outage recovery and refund/dispute fulfillment suspension.
- Only then seek separate release approval, code-lock change and runtime enablement. Neither is part of this branch.
