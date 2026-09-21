CREATE TEMP TABLE `alias_compact` AS
SELECT
	`id`,
	`store_id`,
	`retail_chain_id`,
	replace(replace(replace(replace(replace(`alias`, char(160), ''), char(9), ''), char(10), ''), char(13), ''), ' ', '') AS `compact`
FROM `product_aliases`;--> statement-breakpoint
DELETE FROM `product_aliases` WHERE `id` IN (SELECT `id` FROM `alias_compact` WHERE `compact` = '');--> statement-breakpoint
DELETE FROM `product_aliases` WHERE `id` IN (
	SELECT `id` FROM `alias_compact`
	WHERE `store_id` IS NOT NULL
		AND `id` NOT IN (
			SELECT MIN(`id`) FROM `alias_compact`
			WHERE `store_id` IS NOT NULL AND `compact` != ''
			GROUP BY `store_id`, `compact` COLLATE NOCASE
		)
);--> statement-breakpoint
DELETE FROM `product_aliases` WHERE `id` IN (
	SELECT `id` FROM `alias_compact`
	WHERE `retail_chain_id` IS NOT NULL
		AND `id` NOT IN (
			SELECT MIN(`id`) FROM `alias_compact`
			WHERE `retail_chain_id` IS NOT NULL AND `compact` != ''
			GROUP BY `retail_chain_id`, `compact` COLLATE NOCASE
		)
);--> statement-breakpoint
DELETE FROM `product_aliases` WHERE `id` IN (
	SELECT `id` FROM `alias_compact`
	WHERE `store_id` IS NULL AND `retail_chain_id` IS NULL
		AND `id` NOT IN (
			SELECT MIN(`id`) FROM `alias_compact`
			WHERE `store_id` IS NULL AND `retail_chain_id` IS NULL AND `compact` != ''
			GROUP BY `compact` COLLATE NOCASE
		)
);--> statement-breakpoint
UPDATE `product_aliases`
SET `alias` = replace(replace(replace(replace(replace(`alias`, char(160), ''), char(9), ''), char(10), ''), char(13), ''), ' ', '');--> statement-breakpoint
DROP TABLE `alias_compact`;
