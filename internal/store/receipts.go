package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

const (
	ReceiptPending  = "pending"
	ReceiptReady    = "ready"
	ReceiptFailed   = "failed"
	ReceiptMigrated = "migrated"
)

var (
	ErrReceiptMigrated = errors.New("receipt already migrated")
	ErrReceiptNotReady = errors.New("receipt is not ready to migrate")
)

type Receipt struct {
	ID           int64
	ImagePath    string
	RawResponse  string
	Status       string
	ErrorMessage string
	CreatedAt    string
}

func (s *Store) CreateReceipt(imagePath string) (Receipt, error) {
	imagePath = strings.TrimSpace(imagePath)
	if imagePath == "" {
		return Receipt{}, errors.New("image is required")
	}
	res, err := s.db.Exec(
		`INSERT INTO receipts (image_path, raw_response, status, error_message, created_at) VALUES (?, '', ?, '', ?)`,
		imagePath, ReceiptPending, nowRFC3339(),
	)
	if err != nil {
		return Receipt{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Receipt{}, err
	}
	return s.GetReceipt(id)
}

func (s *Store) GetReceipt(id int64) (Receipt, error) {
	var r Receipt
	err := s.db.QueryRow(
		`SELECT id, image_path, raw_response, status, error_message, created_at FROM receipts WHERE id = ?`, id,
	).Scan(&r.ID, &r.ImagePath, &r.RawResponse, &r.Status, &r.ErrorMessage, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, ErrNotFound
	}
	return r, err
}

func (r Receipt) StatusLabel() string {
	switch r.Status {
	case ReceiptMigrated:
		return "Saved"
	case ReceiptReady:
		return "To confirm"
	case ReceiptFailed:
		return "Failed"
	default:
		return "Reading"
	}
}

func (r Receipt) Reading() bool {
	return r.Status == ReceiptPending
}

func (s *Store) ListReceipts() ([]Receipt, error) {
	rows, err := s.db.Query(`
SELECT id, image_path, status, error_message, created_at FROM receipts
ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Receipt
	for rows.Next() {
		var r Receipt
		if err := rows.Scan(&r.ID, &r.ImagePath, &r.Status, &r.ErrorMessage, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) ListPendingReceiptIDs() ([]int64, error) {
	rows, err := s.db.Query(`SELECT id FROM receipts WHERE status = ? ORDER BY id`, ReceiptPending)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) SaveAIResponse(id int64, rawJSON string) error {
	res, err := s.db.Exec(
		`UPDATE receipts SET raw_response = ?, status = ?, error_message = '' WHERE id = ? AND status IN (?, ?)`,
		rawJSON, ReceiptReady, id, ReceiptPending, ReceiptFailed,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		r, getErr := s.GetReceipt(id)
		if getErr != nil {
			return getErr
		}
		if r.Status == ReceiptMigrated {
			return ErrReceiptMigrated
		}
		return ErrNotFound
	}
	return nil
}

func (s *Store) FailReceipt(id int64, msg string) error {
	res, err := s.db.Exec(
		`UPDATE receipts SET status = ?, error_message = ? WHERE id = ? AND status = ?`,
		ReceiptFailed, strings.TrimSpace(msg), id, ReceiptPending,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.GetReceipt(id); err != nil {
			return err
		}
		return ErrNotFound
	}
	return nil
}

func (s *Store) RequeueReceipt(id int64) error {
	res, err := s.db.Exec(
		`UPDATE receipts SET status = ?, error_message = '' WHERE id = ? AND status = ?`,
		ReceiptPending, id, ReceiptFailed,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		r, getErr := s.GetReceipt(id)
		if getErr != nil {
			return getErr
		}
		if r.Status == ReceiptPending {
			return nil
		}
		return ErrReceiptNotReady
	}
	return nil
}

func (s *Store) UpdateReceiptJSON(id int64, rawJSON string) error {
	res, err := s.db.Exec(
		`UPDATE receipts SET raw_response = ? WHERE id = ? AND status = ?`,
		rawJSON, id, ReceiptReady,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.GetReceipt(id); err != nil {
			return err
		}
		return ErrReceiptNotReady
	}
	return nil
}

func (s *Store) MigrateReceipt(id int64, in BillImport, rawJSON string) (BillImportResult, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return BillImportResult{}, err
	}
	defer tx.Rollback()

	r, err := getReceiptTx(tx, id)
	if err != nil {
		return BillImportResult{}, err
	}
	if r.Status == ReceiptMigrated {
		return BillImportResult{}, ErrReceiptMigrated
	}
	if r.Status != ReceiptReady {
		return BillImportResult{}, ErrReceiptNotReady
	}

	in.ReceiptID = id
	res, err := importBillTx(tx, in)
	if err != nil {
		return BillImportResult{}, err
	}
	if _, err := tx.Exec(
		`UPDATE receipts SET status = ?, raw_response = ? WHERE id = ?`,
		ReceiptMigrated, rawJSON, id,
	); err != nil {
		return BillImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BillImportResult{}, err
	}
	return res, nil
}

func (s *Store) UpdateReceiptVisit(id, companyID int64, boughtOn string) error {
	company, err := s.optionalCompanyArg(companyID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	r, err := getReceiptTx(tx, id)
	if err != nil {
		return err
	}
	if r.Status != ReceiptMigrated {
		if r.Status == ReceiptReady {
			return ErrReceiptNotReady
		}
		return ErrNotFound
	}
	if _, err := tx.Exec(`UPDATE purchases SET company_id = ?, bought_on = ? WHERE receipt_id = ?`, company, boughtOn, id); err != nil {
		return err
	}
	raw, err := patchBillVisitJSON(r.RawResponse, companyID, boughtOn)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE receipts SET raw_response = ? WHERE id = ?`, raw, id); err != nil {
		return err
	}
	return tx.Commit()
}

func patchBillVisitJSON(raw string, companyID int64, boughtOn string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "{}"
	}
	var bill map[string]any
	if err := json.Unmarshal([]byte(raw), &bill); err != nil {
		return "", err
	}
	date, clock := SplitBoughtOn(boughtOn)
	bill["bought_on"] = date
	if clock != "" {
		bill["bought_at"] = clock
	} else {
		delete(bill, "bought_at")
	}
	if companyID > 0 {
		bill["company_id"] = companyID
	} else {
		delete(bill, "company_id")
	}
	out, err := json.Marshal(bill)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func getReceiptTx(tx *sql.Tx, id int64) (Receipt, error) {
	var r Receipt
	err := tx.QueryRow(
		`SELECT id, image_path, raw_response, status, error_message, created_at FROM receipts WHERE id = ?`, id,
	).Scan(&r.ID, &r.ImagePath, &r.RawResponse, &r.Status, &r.ErrorMessage, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, ErrNotFound
	}
	return r, err
}
