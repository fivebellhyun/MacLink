ALTER TABLE `invites` ADD `reusable` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `generation` integer DEFAULT 0 NOT NULL;