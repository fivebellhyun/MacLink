CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`agent_hash` text NOT NULL,
	`created` integer NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`info` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `devices_owner` ON `devices` (`owner`);--> statement-breakpoint
CREATE TABLE `inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session` text NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inputs_session` ON `inputs` (`session`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`secret_hash` text NOT NULL,
	`mode` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invites_device` ON `invites` (`device`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`invite` text NOT NULL,
	`guest_hash` text NOT NULL,
	`guest_name` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`transport` text DEFAULT 'webrtc' NOT NULL,
	`offer` text NOT NULL,
	`answer` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`seen` integer NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `sessions_device` ON `sessions` (`device`);