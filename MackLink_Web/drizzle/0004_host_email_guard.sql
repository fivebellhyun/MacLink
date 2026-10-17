CREATE TABLE `invite_verifications` (
	`invite` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `owner_identities` (
	`owner` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`updated` integer NOT NULL
);
