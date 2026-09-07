-- name: ListComparisonGroups :many
SELECT
  g.id,
  g.name,
  g.unit_id,
  u.name AS unit_name,
  g.created_at,
  CAST((SELECT COUNT(*) FROM comparison_group_products m WHERE m.group_id = g.id) AS INTEGER) AS product_count
FROM comparison_groups g
JOIN units u ON u.id = g.unit_id
ORDER BY g.name COLLATE NOCASE, g.id;

-- name: GetComparisonGroup :one
SELECT
  g.id,
  g.name,
  g.unit_id,
  u.name AS unit_name,
  g.created_at,
  CAST((SELECT COUNT(*) FROM comparison_group_products m WHERE m.group_id = g.id) AS INTEGER) AS product_count
FROM comparison_groups g
JOIN units u ON u.id = g.unit_id
WHERE g.id = ?;

-- name: InsertComparisonGroup :one
INSERT INTO comparison_groups (name, unit_id, created_at)
VALUES (?, ?, ?)
RETURNING id;

-- name: UpdateComparisonGroup :execrows
UPDATE comparison_groups
SET name = ?, unit_id = ?
WHERE id = ?;

-- name: DeleteComparisonGroup :execrows
DELETE FROM comparison_groups WHERE id = ?;

-- name: CountComparisonGroupsByID :one
SELECT COUNT(*) FROM comparison_groups WHERE id = ?;

-- name: CountComparisonGroupsByUnit :one
SELECT COUNT(*) FROM comparison_groups WHERE unit_id = ?;

-- name: ListComparisonGroupProductIDs :many
SELECT product_id
FROM comparison_group_products
WHERE group_id = ?
ORDER BY product_id;

-- name: ListComparisonGroupsForProduct :many
SELECT
  g.id,
  g.name,
  g.unit_id,
  u.name AS unit_name,
  g.created_at,
  CAST((SELECT COUNT(*) FROM comparison_group_products m WHERE m.group_id = g.id) AS INTEGER) AS product_count
FROM comparison_group_products mine
JOIN comparison_groups g ON g.id = mine.group_id
JOIN units u ON u.id = g.unit_id
WHERE mine.product_id = ?
ORDER BY g.name COLLATE NOCASE, g.id;

-- name: ListRelatedGroupProducts :many
SELECT DISTINCT
  p.id,
  p.name,
  p.unit_id,
  u.name AS unit_name,
  p.image_path,
  p.created_at
FROM comparison_group_products mine
JOIN comparison_group_products m ON m.group_id = mine.group_id
JOIN products p ON p.id = m.product_id
JOIN units u ON u.id = p.unit_id
WHERE mine.product_id = sqlc.arg('product_id')
  AND p.id != sqlc.arg('exclude_id')
ORDER BY p.name COLLATE NOCASE, p.id;

-- name: DeleteComparisonGroupProducts :exec
DELETE FROM comparison_group_products WHERE group_id = ?;

-- name: DeleteProductComparisonGroups :exec
DELETE FROM comparison_group_products WHERE product_id = ?;

-- name: InsertComparisonGroupProduct :exec
INSERT INTO comparison_group_products (group_id, product_id)
VALUES (?, ?);

-- name: ReassignComparisonGroups :exec
INSERT OR IGNORE INTO comparison_group_products (group_id, product_id)
SELECT m.group_id, sqlc.arg('into_id')
FROM comparison_group_products m
WHERE m.product_id = sqlc.arg('from_id');

-- name: ListComparisonMembersForProduct :many
SELECT
  g.id AS group_id,
  g.name AS group_name,
  g.unit_id AS group_unit_id,
  u.name AS group_unit_name,
  p.id AS product_id,
  p.name AS product_name,
  p.unit_id AS product_unit_id,
  c.factor AS conversion_factor
FROM comparison_group_products mine
JOIN comparison_groups g ON g.id = mine.group_id
JOIN units u ON u.id = g.unit_id
JOIN comparison_group_products m ON m.group_id = g.id
JOIN products p ON p.id = m.product_id
LEFT JOIN product_unit_conversions c
  ON c.product_id = p.id AND c.unit_id = g.unit_id
WHERE mine.product_id = ?
ORDER BY g.name COLLATE NOCASE, g.id, p.name COLLATE NOCASE, p.id;

-- name: ListPurchasesForProductIDs :many
SELECT
  p.id,
  p.product_id,
  CAST(COALESCE(p.story_id, 0) AS INTEGER) AS story_id,
  p.kind,
  CAST(COALESCE(p.receipt_id, 0) AS INTEGER) AS receipt_id,
  p.bought_on,
  p.quantity,
  p.amount,
  p.created_at
FROM purchases p
WHERE p.product_id IN (sqlc.slice('product_ids'))
ORDER BY p.bought_on DESC, p.id DESC;
