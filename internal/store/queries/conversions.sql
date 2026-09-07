-- name: ListProductConversions :many
SELECT c.unit_id, u.name AS unit_name, c.factor
FROM product_unit_conversions c
JOIN units u ON u.id = c.unit_id
WHERE c.product_id = ?
ORDER BY u.name COLLATE NOCASE;

-- name: ListAllProductConversions :many
SELECT c.product_id, c.unit_id, u.name AS unit_name, c.factor
FROM product_unit_conversions c
JOIN units u ON u.id = c.unit_id
ORDER BY u.name COLLATE NOCASE;

-- name: DeleteProductConversions :exec
DELETE FROM product_unit_conversions WHERE product_id = ?;

-- name: InsertProductConversion :exec
INSERT INTO product_unit_conversions (product_id, unit_id, factor)
VALUES (?, ?, ?);
