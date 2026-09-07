-- name: ListAliases :many
SELECT
  a.id,
  a.product_id,
  p.name AS product_name,
  CAST(COALESCE(a.story_id, 0) AS INTEGER) AS story_id,
  COALESCE(c.name, '') AS story_name,
  CAST(COALESCE(a.retail_chain_id, 0) AS INTEGER) AS retail_chain_id,
  COALESCE(rc.name, '') AS retail_chain_name,
  a.alias
FROM product_aliases a
JOIN products p ON p.id = a.product_id
LEFT JOIN stories c ON c.id = a.story_id
LEFT JOIN retail_chains rc ON rc.id = a.retail_chain_id
ORDER BY p.name COLLATE NOCASE, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id;

-- name: ListAliasesByProduct :many
SELECT
  a.id,
  a.product_id,
  p.name AS product_name,
  CAST(COALESCE(a.story_id, 0) AS INTEGER) AS story_id,
  COALESCE(c.name, '') AS story_name,
  CAST(COALESCE(a.retail_chain_id, 0) AS INTEGER) AS retail_chain_id,
  COALESCE(rc.name, '') AS retail_chain_name,
  a.alias
FROM product_aliases a
JOIN products p ON p.id = a.product_id
LEFT JOIN stories c ON c.id = a.story_id
LEFT JOIN retail_chains rc ON rc.id = a.retail_chain_id
WHERE a.product_id = ?
ORDER BY a.story_id IS NOT NULL, a.retail_chain_id IS NOT NULL, c.name COLLATE NOCASE, rc.name COLLATE NOCASE, a.alias COLLATE NOCASE, a.id;

-- name: GetAlias :one
SELECT
  a.id,
  a.product_id,
  p.name AS product_name,
  CAST(COALESCE(a.story_id, 0) AS INTEGER) AS story_id,
  COALESCE(c.name, '') AS story_name,
  CAST(COALESCE(a.retail_chain_id, 0) AS INTEGER) AS retail_chain_id,
  COALESCE(rc.name, '') AS retail_chain_name,
  a.alias
FROM product_aliases a
JOIN products p ON p.id = a.product_id
LEFT JOIN stories c ON c.id = a.story_id
LEFT JOIN retail_chains rc ON rc.id = a.retail_chain_id
WHERE a.id = ?;

-- name: InsertAlias :one
INSERT INTO product_aliases (product_id, story_id, retail_chain_id, alias)
VALUES (?, ?, ?, ?)
RETURNING id;

-- name: UpdateAlias :execrows
UPDATE product_aliases
SET product_id = ?, story_id = ?, retail_chain_id = ?, alias = ?
WHERE id = ?;

-- name: DeleteAlias :execrows
DELETE FROM product_aliases WHERE id = ?;

-- name: CountAliasesByAlias :one
SELECT COUNT(*) FROM product_aliases WHERE alias = ? COLLATE NOCASE;

-- name: CountAliasesByAliasExcept :one
SELECT COUNT(*) FROM product_aliases WHERE alias = ? COLLATE NOCASE AND product_id != ?;

-- name: ProductByStoryAlias :one
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM product_aliases a
JOIN products p ON p.id = a.product_id
JOIN units u ON u.id = p.unit_id
WHERE a.alias = ? COLLATE NOCASE AND a.story_id = ?
ORDER BY a.id
LIMIT 1;

-- name: ProductByChainAlias :one
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM product_aliases a
JOIN products p ON p.id = a.product_id
JOIN units u ON u.id = p.unit_id
WHERE a.alias = ? COLLATE NOCASE AND a.retail_chain_id = ?
ORDER BY a.id
LIMIT 1;

-- name: ProductByGlobalAlias :one
SELECT p.id, p.name, p.unit_id, u.name AS unit_name, p.image_path, p.created_at
FROM product_aliases a
JOIN products p ON p.id = a.product_id
JOIN units u ON u.id = p.unit_id
WHERE a.alias = ? COLLATE NOCASE AND a.story_id IS NULL AND a.retail_chain_id IS NULL
ORDER BY a.id
LIMIT 1;

-- name: ReassignAliases :exec
UPDATE product_aliases SET product_id = sqlc.arg('into_id') WHERE product_id = sqlc.arg('from_id');

-- name: DropConflictingAliases :exec
DELETE FROM product_aliases
WHERE product_aliases.product_id = sqlc.arg('from_id')
  AND (
    product_aliases.alias = sqlc.arg('into_name') COLLATE NOCASE
    OR EXISTS (
      SELECT 1 FROM product_aliases AS k
      WHERE k.product_id = sqlc.arg('into_id')
        AND k.alias = product_aliases.alias COLLATE NOCASE
        AND (
          (k.story_id IS NULL AND product_aliases.story_id IS NULL)
          OR k.story_id = product_aliases.story_id
        )
    )
  );
