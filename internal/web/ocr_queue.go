package web

import (
	"errors"
	"log"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

const ocrJobBuffer = 32

func (s *Server) startOCRWorker() {
	s.ocrJobs = make(chan int64, ocrJobBuffer)
	go s.runOCRWorker()
}

// RecoverOCR enqueues receipts that were still pending when the process last
// stopped, so a restart finishes work that never reached the vision API.
func (s *Server) RecoverOCR() {
	ids, err := s.store.ListPendingReceiptIDs()
	if err != nil {
		log.Printf("ocr recover: %v", err)
		return
	}
	for _, id := range ids {
		s.enqueueOCR(id)
	}
}

// enqueueOCR queues one receipt. A later multi-file upload can call this once
// per stored file; the worker reads them in order, one at a time.
func (s *Server) enqueueOCR(id int64) {
	if s.ocrJobs == nil {
		return
	}
	select {
	case s.ocrJobs <- id:
	default:
		go func() { s.ocrJobs <- id }()
	}
}

func (s *Server) runOCRWorker() {
	for id := range s.ocrJobs {
		s.processOCRJob(id)
	}
}

func (s *Server) processOCRJob(id int64) {
	receipt, err := s.store.GetReceipt(id)
	if err != nil {
		return
	}
	if receipt.Status != store.ReceiptPending {
		return
	}

	raw, err := s.loadReceiptSource(receipt.ImagePath)
	if err != nil {
		_ = s.store.FailReceipt(id, "Could not read the stored bill.")
		return
	}
	if !s.reader.Configured() {
		return
	}
	model, err := s.ocrModel()
	if err != nil || model == "" {
		return
	}

	_, rawJSON, err := s.reader.WithModel(model).Extract(raw)
	if err != nil {
		_ = s.store.FailReceipt(id, ocrFailMessage(err))
		return
	}
	if err := s.store.SaveAIResponse(id, string(rawJSON)); err != nil {
		_ = s.store.FailReceipt(id, "Could not save the AI response.")
	}
}

func ocrFailMessage(err error) string {
	if errors.Is(err, ocr.ErrNotABill) {
		return "That file does not look like a bill. Try a clearer photo of the whole receipt, or another PDF."
	}
	if errors.Is(err, ocr.ErrNoLines) {
		return "No products could be read from this bill. Try another photo or PDF."
	}
	if errors.Is(err, ocr.ErrNoPDFText) {
		return "This PDF could not be turned into images. Install poppler or run Bulkly in Docker, or photograph the bill."
	}
	return "Could not read the bill: " + err.Error()
}
