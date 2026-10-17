ALTER TABLE `sessions` ADD `quality` text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `quality_applied` text;