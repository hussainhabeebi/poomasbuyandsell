CREATE TABLE `nomod_attempts` (
	`order_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`note` text NOT NULL,
	`state` text NOT NULL,
	`link_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nomod_attempts_id_unique` ON `nomod_attempts` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `nomod_attempts_link_id_unique` ON `nomod_attempts` (`link_id`);--> statement-breakpoint
CREATE TABLE `nomod_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`outcome` text NOT NULL,
	`link_id` text,
	`actor_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nomod_audit_order` ON `nomod_audit` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nomod_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`object_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`order_id` text,
	`link_id` text,
	`reference_id` text,
	`note` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`charge_status` text NOT NULL,
	`provider_created_at` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nomod_events_pending` ON `nomod_events` (`order_id`,`outcome`);--> statement-breakpoint
CREATE TABLE `nomod_payments` (
	`order_id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`link_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nomod_payments_charge_id_unique` ON `nomod_payments` (`charge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `nomod_payments_link_id_unique` ON `nomod_payments` (`link_id`);