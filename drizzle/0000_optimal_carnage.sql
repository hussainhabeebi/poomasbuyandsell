CREATE TABLE `enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_enquiries_listing` ON `enquiries` (`listing_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_id` text NOT NULL,
	`seller_name` text NOT NULL,
	`seller_email` text NOT NULL,
	`phone` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`subtype` text NOT NULL,
	`emirate` text NOT NULL,
	`area` text NOT NULL,
	`price` real NOT NULL,
	`intent` text NOT NULL,
	`description` text NOT NULL,
	`specs` text DEFAULT '{}' NOT NULL,
	`images` text DEFAULT '[]' NOT NULL,
	`video` text,
	`permit` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`rejection_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_slug_unique` ON `listings` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_listings_status_category` ON `listings` (`status`,`category`);--> statement-breakpoint
CREATE INDEX `idx_listings_owner` ON `listings` (`owner_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`listing_id` text,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`package_id` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'AED' NOT NULL,
	`nomod_id` text,
	`payment_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_promotions_owner` ON `promotions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_promotions_nomod` ON `promotions` (`nomod_id`);--> statement-breakpoint
CREATE TABLE `saved` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_saved_user_listing` ON `saved` (`user_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
