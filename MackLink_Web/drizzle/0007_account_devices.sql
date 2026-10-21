ALTER TABLE `sessions` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_session_hash` text;--> statement-breakpoint
CREATE INDEX `sessions_auth` ON `sessions` (`auth_session_hash`);--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `invite`;--> statement-breakpoint
DROP TABLE `invite_verifications`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
DROP TABLE `owner_identities`;
