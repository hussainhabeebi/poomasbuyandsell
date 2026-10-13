import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const listings = sqliteTable('listings', {
    id: text('id').primaryKey(), slug: text('slug').notNull().unique(), ownerId: text('owner_id').notNull(), sellerName: text('seller_name').notNull(), sellerEmail: text('seller_email').notNull(), phone: text('phone').notNull(), title: text('title').notNull(), category: text('category').notNull(), subtype: text('subtype').notNull(), emirate: text('emirate').notNull(), area: text('area').notNull(), price: real('price').notNull(), intent: text('intent').notNull(), description: text('description').notNull(), specs: text('specs').notNull().default('{}'), images: text('images').notNull().default('[]'), video: text('video'), permit: text('permit'), status: text('status').notNull().default('pending'), rejectionReason: text('rejection_reason'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
}, t => [index('idx_listings_status_category').on(t.status, t.category), index('idx_listings_owner').on(t.ownerId)]);
export const saved = sqliteTable('saved', { id: text('id').primaryKey(), userId: text('user_id').notNull(), listingId: text('listing_id').notNull().references(() => listings.id), createdAt: text('created_at').notNull() }, t => [uniqueIndex('idx_saved_user_listing').on(t.userId, t.listingId)]);
export const enquiries = sqliteTable('enquiries', { id: text('id').primaryKey(), listingId: text('listing_id').notNull().references(() => listings.id), buyerId: text('buyer_id').notNull(), name: text('name').notNull(), email: text('email').notNull(), phone: text('phone').notNull(), message: text('message').notNull(), kind: text('kind').notNull(), createdAt: text('created_at').notNull() }, t => [index('idx_enquiries_listing').on(t.listingId)]);
export const promotions = sqliteTable('promotions', { id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), listingId: text('listing_id').notNull().references(() => listings.id), packageId: text('package_id').notNull(), notes: text('notes').notNull().default(''), status: text('status').notNull().default('requested'), amount: real('amount'), currency: text('currency').notNull().default('AED'), nomodId: text('nomod_id'), paymentUrl: text('payment_url'), createdAt: text('created_at').notNull() }, t => [index('idx_promotions_owner').on(t.ownerId), index('idx_promotions_nomod').on(t.nomodId)]);
export const media = sqliteTable('media', { id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), listingId: text('listing_id').references(() => listings.id), contentType: text('content_type').notNull(), createdAt: text('created_at').notNull() });
export const webhookEvents = sqliteTable('webhook_events', { id: text('id').primaryKey(), createdAt: text('created_at').notNull() });
export const nomodAttempts = sqliteTable('nomod_attempts', {
    orderId: text('order_id').primaryKey().references(() => promotions.id), id: text('id').notNull().unique(),
    note: text('note').notNull(), state: text('state').notNull(), linkId: text('link_id').unique(),
    createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});
export const nomodEvents = sqliteTable('nomod_events', {
    id: text('id').primaryKey(), type: text('type').notNull(), objectId: text('object_id').notNull(), chargeId: text('charge_id').notNull(),
    orderId: text('order_id'), linkId: text('link_id'), referenceId: text('reference_id'), note: text('note').notNull(),
    amount: text('amount').notNull(), currency: text('currency').notNull(), chargeStatus: text('charge_status').notNull(),
    providerCreatedAt: text('provider_created_at'), receivedAt: text('received_at').notNull(), processedAt: text('processed_at'), outcome: text('outcome').notNull()
}, t => [index('idx_nomod_events_pending').on(t.orderId, t.outcome)]);
export const nomodPayments = sqliteTable('nomod_payments', {
    orderId: text('order_id').primaryKey().references(() => promotions.id), chargeId: text('charge_id').notNull().unique(),
    linkId: text('link_id').notNull().unique(), createdAt: text('created_at').notNull()
});
export const nomodAudit = sqliteTable('nomod_audit', {
    id: text('id').primaryKey(), orderId: text('order_id').notNull(), type: text('type').notNull(), outcome: text('outcome').notNull(),
    linkId: text('link_id'), actorId: text('actor_id'), createdAt: text('created_at').notNull()
}, t => [index('idx_nomod_audit_order').on(t.orderId, t.createdAt)]);
export const limits = sqliteTable('rate_limits', { key: text('key').primaryKey(), count: integer('count').notNull(), window: integer('window').notNull() });
