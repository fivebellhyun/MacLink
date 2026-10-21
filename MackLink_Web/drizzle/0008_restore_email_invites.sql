CREATE TABLE `invite_verifications` (
	`invite` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`secret_hash` text NOT NULL,
	`reusable` integer DEFAULT 0 NOT NULL,
	`mode` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invites_device` ON `invites` (`device`);--> statement-breakpoint
CREATE TABLE `owner_identities` (
	`owner` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `invite` text DEFAULT '' NOT NULL;