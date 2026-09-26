ALTER TABLE `units` ADD `compare_value` text DEFAULT '1' NOT NULL;
--> statement-breakpoint
UPDATE `units` SET `compare_value` = '1';