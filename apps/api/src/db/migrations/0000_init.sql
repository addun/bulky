CREATE TABLE `units` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_name` ON `units` ("name" collate nocase);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit_id` integer NOT NULL,
	`image_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_products_name` ON `products` ("name" collate nocase);--> statement-breakpoint
CREATE TABLE `retail_chains` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text NOT NULL,
	`tax_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_chains_name` ON `retail_chains` ("name" collate nocase);--> statement-breakpoint
CREATE UNIQUE INDEX `retail_chains_tax_id` ON `retail_chains` ("tax_id" collate nocase);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`street_name` text NOT NULL,
	`building_number` text NOT NULL,
	`apartment_number` text DEFAULT '' NOT NULL,
	`postal_code` text NOT NULL,
	`city` text NOT NULL,
	`retail_chain_id` integer,
	`external_id` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`retail_chain_id`) REFERENCES `retail_chains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stories_name` ON `stories` ("name" collate nocase);--> statement-breakpoint
CREATE INDEX `idx_stories_retail_chain` ON `stories` (`retail_chain_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stories_external_id` ON `stories` ("external_id" collate nocase) WHERE external_id != '';--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY NOT NULL,
	`image_path` text NOT NULL,
	`raw_response` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`source_payload` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receipts_status` ON `receipts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_receipts_source_external` ON `receipts` (`source`,`external_id`) WHERE source != '' AND external_id != '';--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`story_id` integer,
	`bought_on` text NOT NULL,
	`quantity` text NOT NULL,
	`amount` text NOT NULL,
	`created_at` text NOT NULL,
	`kind` text DEFAULT 'purchase' NOT NULL,
	`receipt_id` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_purchases_product` ON `purchases` (`product_id`,`bought_on`);--> statement-breakpoint
CREATE INDEX `idx_purchases_story` ON `purchases` (`story_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_receipt` ON `purchases` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `product_aliases` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`story_id` integer,
	`retail_chain_id` integer,
	`alias` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retail_chain_id`) REFERENCES `retail_chains`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_aliases_scope" CHECK(NOT (story_id IS NOT NULL AND retail_chain_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_product_aliases_product` ON `product_aliases` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_shop` ON `product_aliases` (`story_id`,"alias" collate nocase) WHERE story_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_chain` ON `product_aliases` (`retail_chain_id`,"alias" collate nocase) WHERE retail_chain_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_global` ON `product_aliases` ("alias" collate nocase) WHERE story_id IS NULL AND retail_chain_id IS NULL;--> statement-breakpoint
CREATE TABLE `product_unit_conversions` (
	`product_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`factor` text NOT NULL,
	PRIMARY KEY(`product_id`, `unit_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comparison_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comparison_groups_name` ON `comparison_groups` ("name" collate nocase);--> statement-breakpoint
CREATE INDEX `idx_comparison_groups_unit` ON `comparison_groups` (`unit_id`);--> statement-breakpoint
CREATE TABLE `comparison_group_products` (
	`group_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	PRIMARY KEY(`group_id`, `product_id`),
	FOREIGN KEY (`group_id`) REFERENCES `comparison_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_comparison_group_products_product` ON `comparison_group_products` (`product_id`);
