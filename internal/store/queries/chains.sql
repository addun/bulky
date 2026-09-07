-- name: ListRetailChains :many
SELECT
  rc.id,
  rc.name,
  rc.legal_name,
  rc.tax_id,
  CAST((SELECT COUNT(*) FROM stories s WHERE s.retail_chain_id = rc.id) AS INTEGER) AS story_count
FROM retail_chains rc
ORDER BY rc.name COLLATE NOCASE, rc.id;

-- name: GetRetailChain :one
SELECT
  rc.id,
  rc.name,
  rc.legal_name,
  rc.tax_id,
  CAST((SELECT COUNT(*) FROM stories s WHERE s.retail_chain_id = rc.id) AS INTEGER) AS story_count
FROM retail_chains rc
WHERE rc.id = ?;

-- name: InsertRetailChain :one
INSERT INTO retail_chains (name, legal_name, tax_id)
VALUES (?, ?, ?)
RETURNING id;

-- name: UpdateRetailChain :execrows
UPDATE retail_chains
SET name = ?, legal_name = ?, tax_id = ?
WHERE id = ?;

-- name: DeleteRetailChain :execrows
DELETE FROM retail_chains WHERE id = ?;

-- name: CountRetailChainsByID :one
SELECT COUNT(*) FROM retail_chains WHERE id = ?;
