package store

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/adrian/bulkly/internal/store/sqlc"
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
	id, err := s.q.InsertReceipt(ctx(), sqlc.InsertReceiptParams{
		ImagePath: imagePath,
		Status:    ReceiptPending,
		CreatedAt: nowRFC3339(),
	})
	if err != nil {
		return Receipt{}, err
	}
	return s.GetReceipt(id)
}

func (s *Store) GetReceipt(id int64) (Receipt, error) {
	return getReceipt(s.q, id)
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
	rows, err := s.q.ListReceipts(ctx())
	if err != nil {
		return nil, err
	}
	return mapReceipts(rows), nil
}

func (s *Store) ListPendingReceiptIDs() ([]int64, error) {
	return s.q.ListPendingReceiptIDs(ctx(), ReceiptPending)
}

func (s *Store) SaveAIResponse(id int64, rawJSON string) error {
	n, err := s.q.SaveAIResponse(ctx(), sqlc.SaveAIResponseParams{
		RawResponse: rawJSON,
		Status:      ReceiptReady,
		ID:          id,
		Status_2:    ReceiptPending,
		Status_3:    ReceiptFailed,
	})
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
	n, err := s.q.FailReceipt(ctx(), sqlc.FailReceiptParams{
		Status:       ReceiptFailed,
		ErrorMessage: strings.TrimSpace(msg),
		ID:           id,
		Status_2:     ReceiptPending,
	})
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
	n, err := s.q.RequeueReceipt(ctx(), sqlc.RequeueReceiptParams{
		Status:   ReceiptPending,
		ID:       id,
		Status_2: ReceiptFailed,
	})
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
	n, err := s.q.UpdateReceiptJSON(ctx(), sqlc.UpdateReceiptJSONParams{
		RawResponse: rawJSON,
		ID:          id,
		Status:      ReceiptReady,
	})
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
	var res BillImportResult
	err := s.withTx(func(q *sqlc.Queries) error {
		r, err := getReceipt(q, id)
		if err != nil {
			return err
		}
		if r.Status == ReceiptMigrated {
			return ErrReceiptMigrated
		}
		if r.Status != ReceiptReady {
			return ErrReceiptNotReady
		}
		in.ReceiptID = id
		res, err = importBill(q, in)
		if err != nil {
			return err
		}
		return q.MarkReceiptMigrated(ctx(), sqlc.MarkReceiptMigratedParams{
			Status:      ReceiptMigrated,
			RawResponse: rawJSON,
			ID:          id,
		})
	})
	return res, err
}

func (s *Store) UpdateReceiptVisit(id, storyID int64, boughtOn string) error {
	story, err := optionalStory(s.q, storyID)
	if err != nil {
		return err
	}
	boughtOn, err = NormalizeBoughtOn(boughtOn)
	if err != nil {
		return err
	}
	return s.withTx(func(q *sqlc.Queries) error {
		r, err := getReceipt(q, id)
		if err != nil {
			return err
		}
		if r.Status != ReceiptMigrated {
			if r.Status == ReceiptReady {
				return ErrReceiptNotReady
			}
			return ErrNotFound
		}
		if err := q.UpdatePurchasesVisitByReceipt(ctx(), sqlc.UpdatePurchasesVisitByReceiptParams{
			StoryID:   story,
			BoughtOn:  boughtOn,
			ReceiptID: nullID(id),
		}); err != nil {
			return err
		}
		raw, err := patchBillVisitJSON(r.RawResponse, storyID, boughtOn)
		if err != nil {
			return err
		}
		return q.UpdateReceiptRaw(ctx(), sqlc.UpdateReceiptRawParams{RawResponse: raw, ID: id})
	})
}

func patchBillVisitJSON(raw string, storyID int64, boughtOn string) (string, error) {
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
	if storyID > 0 {
		bill["company_id"] = storyID
	} else {
		delete(bill, "company_id")
	}
	out, err := json.Marshal(bill)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
