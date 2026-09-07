-- name: ListUnits :many
SELECT
  u.id,
  u.name,
  CAST(
    (SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
    + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id)
    AS INTEGER
  ) AS product_count
FROM units u
ORDER BY u.name COLLATE NOCASE;

-- name: GetUnit :one
SELECT
  u.id,
  u.name,
  CAST(
    (SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
    + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id)
    AS INTEGER
  ) AS product_count
FROM units u
WHERE u.id = ?;

-- name: FindUnitByName :one
SELECT
  u.id,
  u.name,
  CAST(
    (SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id)
    + (SELECT COUNT(*) FROM product_unit_conversions c WHERE c.unit_id = u.id)
    AS INTEGER
  ) AS product_count
FROM units u
WHERE u.name = ? COLLATE NOCASE;

-- name: InsertUnit :one
INSERT INTO units (name)
VALUES (?)
RETURNING id;

-- name: UpdateUnit :execrows
UPDATE units
SET name = ?
WHERE id = ?;

-- name: DeleteUnit :execrows
DELETE FROM units
WHERE id = ?;

-- name: CountUnitsByID :one
SELECT COUNT(*) FROM units WHERE id = ?;
