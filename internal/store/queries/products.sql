-- name: ListProducts :many
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
ORDER BY p.name COLLATE NOCASE;

-- name: GetProduct :one
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.id = ?;

-- name: FindProductByName :one
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.name = ? COLLATE NOCASE
ORDER BY p.id
LIMIT 1;

-- name: InsertProduct :one
INSERT INTO products (name, unit_id, image_path, created_at)
VALUES (?, ?, ?, ?)
RETURNING id;

-- name: UpdateProduct :execrows
UPDATE products
SET name = ?, unit_id = ?, image_path = ?
WHERE id = ?;

-- name: UpdateProductUnit :exec
UPDATE products SET unit_id = ? WHERE id = ?;

-- name: UpdateProductImage :exec
UPDATE products SET image_path = ? WHERE id = ?;

-- name: DeleteProduct :exec
DELETE FROM products WHERE id = ?;

-- name: CountProductsByID :one
SELECT COUNT(*) FROM products WHERE id = ?;

-- name: CountProductsByName :one
SELECT COUNT(*) FROM products WHERE name = ? COLLATE NOCASE;

-- name: CountProductsByNameExcept :one
SELECT COUNT(*) FROM products WHERE name = ? COLLATE NOCASE AND id != ?;
