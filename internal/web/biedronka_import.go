package web

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

type biedronkaImportReq struct {
	ID         string          `json:"id"`
	Date       string          `json:"date"`
	StoreName  string          `json:"store_name"`
	ReceiptNum string          `json:"receipt_num"`
	TotalPrice float64         `json:"total_price"`
	Receipt    json.RawMessage `json:"receipt"`
}

func (s *Server) biedronkaImport(c *gin.Context) {
	auth := strings.TrimSpace(c.GetHeader("Authorization"))
	if auth == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}
	var in biedronkaImportReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bill"})
		return
	}
	id, ok := biedronkaTxID(in.ID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	receiptJSON := bytes.TrimSpace(in.Receipt)
	if len(receiptJSON) == 0 || string(receiptJSON) == "null" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing e-receipt"})
		return
	}
	tx := ocr.Tx{
		ID:         id,
		Date:       in.Date,
		StoreName:  in.StoreName,
		ReceiptNum: in.ReceiptNum,
		TotalPrice: in.TotalPrice,
	}
	bill, err := ocr.BillFromBiedronka(receiptJSON, tx)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "id": id})
		return
	}
	rawJSON, err := json.Marshal(bill)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the bill"})
		return
	}
	pdf := s.fetchBiedronkaPDF(c, id, auth)
	jpeg, src, err := biedronkaPreview(pdf, bill, tx)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "could not make a receipt image", "id": id})
		return
	}
	imagePath, err := s.saveReceiptFiles(src, jpeg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not store the bill"})
		return
	}
	receipt, err := s.store.CreateSourcedReceipt(imagePath, store.ReceiptSourceBiedronka, id)
	if errors.Is(err, store.ErrDuplicate) {
		s.deleteReceiptFiles(imagePath)
		c.JSON(http.StatusOK, gin.H{"status": "skipped", "id": id})
		return
	}
	if err != nil {
		s.deleteReceiptFiles(imagePath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the receipt"})
		return
	}
	if err := s.store.SaveAIResponse(receipt.ID, string(rawJSON)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the bill"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":     "imported",
		"id":         id,
		"receipt_id": receipt.ID,
	})
}

func (s *Server) fetchBiedronkaPDF(c *gin.Context, id, auth string) []byte {
	status, _, payload, err := s.biedronkaDo(
		c.Request.Context(),
		http.MethodGet,
		s.biedronkaAPIURL("transactions/"+id+"/e-receipt/"),
		nil,
		map[string]string{"output-format": "pdf", "Accept": "application/pdf"},
		nil,
		auth,
	)
	if err != nil || status < 200 || status >= 300 {
		return nil
	}
	return payload
}

func biedronkaPreview(pdf []byte, bill ocr.Bill, tx ocr.Tx) (jpeg, src []byte, err error) {
	if len(pdf) > 0 {
		jpeg, err = ocr.PreviewJPEG(pdf)
		if err == nil {
			return jpeg, pdf, nil
		}
	}
	jpeg, err = ocr.PreviewText(ocr.BillSlipText(bill, tx))
	if err != nil {
		return nil, nil, err
	}
	return jpeg, jpeg, nil
}
