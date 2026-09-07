-- name: ListPurchasesByProduct :many
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
WHERE p.product_id = ?
ORDER BY p.bought_on DESC, p.id DESC;

-- name: ListPurchasesByProductAsc :many
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
WHERE p.product_id = ?
ORDER BY p.id;

-- name: ListPurchasesByReceipt :many
SELECT
  p.id,
  p.product_id,
  CAST(COALESCE(p.story_id, 0) AS INTEGER) AS story_id,
  p.kind,
  CAST(COALESCE(p.receipt_id, 0) AS INTEGER) AS receipt_id,
  p.bought_on,
  p.quantity,
  p.amount,
  p.created_at,
  pr.name AS product_name,
  u.name AS unit_name,
  pr.image_path
FROM purchases p
JOIN products pr ON pr.id = p.product_id
JOIN units u ON u.id = pr.unit_id
WHERE p.receipt_id = ?
ORDER BY p.id;

-- name: GetPurchase :one
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
WHERE p.id = ?;

-- name: ListPurchaseAmounts :many
SELECT product_id, bought_on, amount
FROM purchases
WHERE kind = ?;

-- name: InsertPurchase :one
INSERT INTO purchases (product_id, story_id, kind, receipt_id, bought_on, quantity, amount, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: UpdatePurchase :execrows
UPDATE purchases
SET story_id = ?, kind = ?, bought_on = ?, quantity = ?, amount = ?
WHERE id = ?;

-- name: UpdatePurchaseQuantity :exec
UPDATE purchases SET quantity = ? WHERE id = ?;

-- name: UpdatePurchasesVisitByReceipt :exec
UPDATE purchases SET story_id = ?, bought_on = ? WHERE receipt_id = ?;

-- name: DeletePurchase :execrows
DELETE FROM purchases WHERE id = ?;

-- name: ReassignPurchases :exec
UPDATE purchases SET product_id = sqlc.arg('into_id') WHERE product_id = sqlc.arg('from_id');
