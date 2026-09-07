-- name: ListStories :many
SELECT
  c.id,
  c.name,
  c.street_name,
  c.building_number,
  c.apartment_number,
  c.postal_code,
  c.city,
  c.external_id,
  CAST(COALESCE(c.retail_chain_id, 0) AS INTEGER) AS retail_chain_id,
  COALESCE(rc.name, '') AS retail_chain_name,
  CAST(COUNT(p.id) AS INTEGER) AS purchase_count
FROM stories c
LEFT JOIN retail_chains rc ON rc.id = c.retail_chain_id
LEFT JOIN purchases p ON p.story_id = c.id
GROUP BY c.id
ORDER BY c.name COLLATE NOCASE, c.id;

-- name: GetStory :one
SELECT
  c.id,
  c.name,
  c.street_name,
  c.building_number,
  c.apartment_number,
  c.postal_code,
  c.city,
  c.external_id,
  CAST(COALESCE(c.retail_chain_id, 0) AS INTEGER) AS retail_chain_id,
  COALESCE(rc.name, '') AS retail_chain_name,
  CAST(COUNT(p.id) AS INTEGER) AS purchase_count
FROM stories c
LEFT JOIN retail_chains rc ON rc.id = c.retail_chain_id
LEFT JOIN purchases p ON p.story_id = c.id
WHERE c.id = ?
GROUP BY c.id;

-- name: InsertStory :one
INSERT INTO stories (
  name, street_name, building_number, apartment_number, postal_code, city, external_id, retail_chain_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: UpdateStory :execrows
UPDATE stories
SET name = ?, street_name = ?, building_number = ?, apartment_number = ?, postal_code = ?, city = ?, external_id = ?, retail_chain_id = ?
WHERE id = ?;

-- name: DeleteStory :execrows
DELETE FROM stories WHERE id = ?;

-- name: CountStoriesByID :one
SELECT COUNT(*) FROM stories WHERE id = ?;

-- name: GetStoryRetailChainID :one
SELECT retail_chain_id FROM stories WHERE id = ?;
