CREATE TABLE `enrollment_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`requests` integer NOT NULL,
	`window` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollment_limits_window` ON `enrollment_limits` (`window`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_hash` text NOT NULL,
	`credential_hash` text NOT NULL,
	`name` text NOT NULL,
	`verification_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner` text,
	`device` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`approved` integer,
	`ip_hash` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollments_expires` ON `enrollments` (`expires`);--> statement-breakpoint
CREATE INDEX `enrollments_approved` ON `enrollments` (`approved`);--> statement-breakpoint
DROP TABLE `invite_verifications`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
DROP TABLE `owner_identities`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `invite`;