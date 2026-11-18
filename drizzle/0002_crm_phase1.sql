CREATE TABLE `crm_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`changes` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_crm_audit_entity` ON `crm_audit` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_audit_created` ON `crm_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `crm_buyers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`enquiry_date` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`source` text NOT NULL,
	`category` text,
	`emirate` text,
	`area` text,
	`budget_min` real,
	`budget_max` real,
	`requirements` text,
	`contact_method` text,
	`assigned_to` text,
	`last_contact_date` text,
	`next_follow_up_date` text,
	`status` text DEFAULT 'New' NOT NULL,
	`internal_notes` text,
	`consent_at` text,
	`duplicate_of` text,
	`created_via` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_buyers_code_unique` ON `crm_buyers` (`code`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_phone` ON `crm_buyers` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_status` ON `crm_buyers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_category` ON `crm_buyers` (`category`,`emirate`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_assigned` ON `crm_buyers` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_follow_up` ON `crm_buyers` (`next_follow_up_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_buyers_created` ON `crm_buyers` (`created_at`);--> statement-breakpoint
CREATE TABLE `crm_counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crm_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_crm_documents_entity` ON `crm_documents` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `crm_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`seller_id` text NOT NULL,
	`business_name` text NOT NULL,
	`category` text NOT NULL,
	`emirate` text NOT NULL,
	`area` text,
	`asking_price` real,
	`monthly_rent` real,
	`operating_costs` real,
	`estimated_profit` real,
	`description` text,
	`media_links` text DEFAULT '[]' NOT NULL,
	`document_verification` text DEFAULT 'Pending' NOT NULL,
	`authorization_status` text DEFAULT 'Pending' NOT NULL,
	`assigned_to` text,
	`availability` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`internal_notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `crm_sellers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_listings_code_unique` ON `crm_listings` (`code`);--> statement-breakpoint
CREATE INDEX `idx_crm_listings_seller` ON `crm_listings` (`seller_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_listings_status` ON `crm_listings` (`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_listings_category` ON `crm_listings` (`category`,`emirate`);--> statement-breakpoint
CREATE INDEX `idx_crm_listings_assigned` ON `crm_listings` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `idx_crm_listings_price` ON `crm_listings` (`asking_price`);--> statement-breakpoint
CREATE TABLE `crm_sellers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`enquiry_date` text NOT NULL,
	`contact_name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`business_name` text,
	`business_type` text,
	`emirate` text,
	`area` text,
	`asking_price` real,
	`monthly_rent` real,
	`estimated_monthly_profit` real,
	`relationship` text,
	`verification_status` text DEFAULT 'Unverified' NOT NULL,
	`business_details` text,
	`source` text NOT NULL,
	`assigned_to` text,
	`next_follow_up_date` text,
	`status` text DEFAULT 'New' NOT NULL,
	`internal_notes` text,
	`consent_at` text,
	`duplicate_of` text,
	`created_via` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_sellers_code_unique` ON `crm_sellers` (`code`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_phone` ON `crm_sellers` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_status` ON `crm_sellers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_category` ON `crm_sellers` (`business_type`,`emirate`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_assigned` ON `crm_sellers` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_follow_up` ON `crm_sellers` (`next_follow_up_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_sellers_created` ON `crm_sellers` (`created_at`);--> statement-breakpoint
CREATE TABLE `crm_staff` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
-- Seed the record-number counters used for BUY-/SEL-/LST- codes (idempotent).
INSERT OR IGNORE INTO `crm_counters` (`name`, `value`) VALUES ('buyer', 0), ('seller', 0), ('listing', 0);