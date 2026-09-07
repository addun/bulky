-- name: InsertReceipt :one
INSERT INTO receipts (image_path, raw_response, status, error_message, created_at)
VALUES (?, '', ?, '', ?)
RETURNING id;

-- name: GetReceipt :one
SELECT id, image_path, raw_response, status, created_at, error_message
FROM receipts
WHERE id = ?;

-- name: ListReceipts :many
SELECT id, image_path, status, error_message, created_at
FROM receipts
ORDER BY id DESC;

-- name: ListPendingReceiptIDs :many
SELECT id FROM receipts WHERE status = ? ORDER BY id;

-- name: SaveAIResponse :execrows
UPDATE receipts
SET raw_response = ?, status = ?, error_message = ''
WHERE id = ? AND status IN (?, ?);

-- name: FailReceipt :execrows
UPDATE receipts
SET status = ?, error_message = ?
WHERE id = ? AND status = ?;

-- name: RequeueReceipt :execrows
UPDATE receipts
SET status = ?, error_message = ''
WHERE id = ? AND status = ?;

-- name: UpdateReceiptJSON :execrows
UPDATE receipts
SET raw_response = ?
WHERE id = ? AND status = ?;

-- name: MarkReceiptMigrated :exec
UPDATE receipts
SET status = ?, raw_response = ?
WHERE id = ?;

-- name: UpdateReceiptRaw :exec
UPDATE receipts SET raw_response = ? WHERE id = ?;
