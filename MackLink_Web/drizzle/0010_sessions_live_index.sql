DROP INDEX `sessions_device`;--> statement-breakpoint
CREATE INDEX `sessions_device_created` ON `sessions` (`device`,`created`);--> statement-breakpoint
CREATE INDEX `sessions_device_live` ON `sessions` (`device`,`created`) WHERE status != 'ended';