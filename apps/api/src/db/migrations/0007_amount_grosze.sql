PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer,
	`bought_on` text NOT NULL,
	`quantity` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	`kind` text DEFAULT 'purchase' NOT NULL,
	`receipt_id` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_purchases`("id", "product_id", "store_id", "bought_on", "quantity", "amount", "created_at", "kind", "receipt_id")
SELECT
	"id",
	"product_id",
	"store_id",
	"bought_on",
	"quantity",
	CASE
		WHEN instr("amount", '.') = 0
			AND "amount" GLOB '[0-9]*'
			AND "amount" NOT GLOB '*[^0-9]*'
			THEN CAST("amount" AS INTEGER) * 100
		WHEN instr("amount", '.') > 1
			AND substr("amount", 1, instr("amount", '.') - 1) GLOB '[0-9]*'
			AND substr("amount", 1, instr("amount", '.') - 1) NOT GLOB '*[^0-9]*'
			AND length(substr("amount", instr("amount", '.') + 1)) BETWEEN 1 AND 2
			AND substr("amount", instr("amount", '.') + 1) GLOB '[0-9]*'
			AND substr("amount", instr("amount", '.') + 1) NOT GLOB '*[^0-9]*'
			THEN CAST(substr("amount", 1, instr("amount", '.') - 1) AS INTEGER) * 100
				+ CAST(substr("amount" || '0', instr("amount", '.') + 1, 2) AS INTEGER)
	END,
	"created_at",
	"kind",
	"receipt_id"
FROM `purchases`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `__new_purchases` RENAME TO `purchases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_purchases_product` ON `purchases` (`product_id`,`bought_on`);--> statement-breakpoint
CREATE INDEX `idx_purchases_store` ON `purchases` (`store_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_receipt` ON `purchases` (`receipt_id`);
