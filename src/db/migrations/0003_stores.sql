ALTER TABLE `stories` RENAME TO `stores`;--> statement-breakpoint
DROP INDEX `idx_stories_name`;--> statement-breakpoint
CREATE INDEX `idx_stores_name` ON `stores` ("name" collate nocase);--> statement-breakpoint
DROP INDEX `idx_stories_retail_chain`;--> statement-breakpoint
CREATE INDEX `idx_stores_retail_chain` ON `stores` (`retail_chain_id`);--> statement-breakpoint
DROP INDEX `idx_stories_external_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stores_external_id` ON `stores` ("external_id" collate nocase) WHERE external_id != '';--> statement-breakpoint
CREATE TABLE `purchases_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer,
	`bought_on` text NOT NULL,
	`quantity` text NOT NULL,
	`amount` text NOT NULL,
	`created_at` text NOT NULL,
	`kind` text DEFAULT 'purchase' NOT NULL,
	`receipt_id` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `purchases_new` (`id`, `product_id`, `store_id`, `bought_on`, `quantity`, `amount`, `created_at`, `kind`, `receipt_id`)
SELECT `id`, `product_id`, `story_id`, `bought_on`, `quantity`, `amount`, `created_at`, `kind`, `receipt_id` FROM `purchases`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `purchases_new` RENAME TO `purchases`;--> statement-breakpoint
CREATE INDEX `idx_purchases_product` ON `purchases` (`product_id`,`bought_on`);--> statement-breakpoint
CREATE INDEX `idx_purchases_store` ON `purchases` (`store_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_receipt` ON `purchases` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `product_aliases_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer,
	`retail_chain_id` integer,
	`alias` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retail_chain_id`) REFERENCES `retail_chains`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_aliases_scope" CHECK(NOT (store_id IS NOT NULL AND retail_chain_id IS NOT NULL))
);--> statement-breakpoint
INSERT INTO `product_aliases_new` (`id`, `product_id`, `store_id`, `retail_chain_id`, `alias`)
SELECT `id`, `product_id`, `story_id`, `retail_chain_id`, `alias` FROM `product_aliases`;--> statement-breakpoint
DROP TABLE `product_aliases`;--> statement-breakpoint
ALTER TABLE `product_aliases_new` RENAME TO `product_aliases`;--> statement-breakpoint
CREATE INDEX `idx_product_aliases_product` ON `product_aliases` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_shop` ON `product_aliases` (`store_id`,"alias" collate nocase) WHERE store_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_chain` ON `product_aliases` (`retail_chain_id`,"alias" collate nocase) WHERE retail_chain_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_aliases_global` ON `product_aliases` ("alias" collate nocase) WHERE store_id IS NULL AND retail_chain_id IS NULL;
