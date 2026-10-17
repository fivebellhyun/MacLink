CREATE TABLE `turn_credentials` (
	`subject` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`sealed` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turn_credentials_owner` ON `turn_credentials` (`owner`);--> statement-breakpoint
CREATE INDEX `turn_credentials_expires` ON `turn_credentials` (`expires`);--> statement-breakpoint
CREATE TABLE `turn_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated` integer NOT NULL
);
