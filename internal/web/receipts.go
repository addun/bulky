package web

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) receipts(c *gin.Context) {
	s.renderReceipts(c, http.StatusOK, c.Query("error"))
}

func (s *Server) scanReceipt(c *gin.Context) {
	if !s.reader.Configured() {
		c.Redirect(http.StatusSeeOther, "/receipts?error="+url.QueryEscape("Set OCR_API_KEY or OCR_BASE_URL so the reader can run."))
		return
	}
	fh, err := pickFormFile(c, "bill", "bill_camera")
	if err != nil {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "Choose a photo or a PDF of the bill.")
		return
	}
	if fh.Size > ocr.MaxImageBytes {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "File must be 10 MB or smaller.")
		return
	}
	f, err := fh.Open()
	if err != nil {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "Could not read the file.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(f, ocr.MaxImageBytes+1))
	f.Close()
	if err != nil {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "Could not read the file.")
		return
	}
	if int64(len(raw)) > ocr.MaxImageBytes {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "File must be 10 MB or smaller.")
		return
	}

	jpeg, err := ocr.PreviewJPEG(raw)
	if err != nil {
		s.renderReceipts(c, http.StatusUnprocessableEntity, strings.TrimSuffix(err.Error(), ".")+".")
		return
	}
	imagePath, err := s.saveReceiptImage(jpeg)
	if err != nil {
		s.renderReceipts(c, http.StatusInternalServerError, "Could not store the bill.")
		return
	}

	receipt, err := s.store.CreateReceipt(imagePath)
	if err != nil {
		s.deleteReceiptImage(imagePath)
		s.renderReceipts(c, http.StatusInternalServerError, "Could not save the receipt.")
		return
	}

	_, rawJSON, err := s.reader.Extract(raw)
	if err != nil {
		_ = s.store.FailReceipt(receipt.ID)
		msg := "Could not read the bill: " + err.Error()
		if errors.Is(err, ocr.ErrNotABill) {
			msg = "That file does not look like a bill. Try a clearer photo of the whole receipt, or a text PDF."
		} else if errors.Is(err, ocr.ErrNoLines) {
			msg = "No products could be read from this bill. Try another photo or PDF."
		} else if errors.Is(err, ocr.ErrNoPDFText) {
			msg = "This PDF has no selectable text. Run Bulkly in Docker to read scanned PDFs, or photograph the bill."
		}
		status := http.StatusBadGateway
		if errors.Is(err, ocr.ErrNotABill) || errors.Is(err, ocr.ErrNoLines) || errors.Is(err, ocr.ErrNoPDFText) {
			status = http.StatusUnprocessableEntity
		}
		s.renderReceipts(c, status, msg)
		return
	}

	if err := s.store.SaveAIResponse(receipt.ID, string(rawJSON)); err != nil {
		_ = s.store.FailReceipt(receipt.ID)
		s.renderReceipts(c, http.StatusInternalServerError, "Could not save the AI response.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/receipts/"+itoa(receipt.ID))
}

func (s *Server) showReceipt(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	receipt, err := s.store.GetReceipt(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the receipt")
		return
	}
	if receipt.Status == store.ReceiptFailed || receipt.Status == store.ReceiptPending {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "This scan has no product list yet. Upload the bill again.")
		return
	}
	products, units, companies, err := s.receiptLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	aliases, err := s.store.ListAliases()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load aliases")
		return
	}
	view, err := receiptToView(receipt, products, units, companies, aliases)
	if err != nil {
		s.renderReceipts(c, http.StatusInternalServerError, "Could not read the saved AI response.")
		return
	}
	s.renderReceiptReview(c, http.StatusOK, view, products, units, companies, c.Query("error"))
}

func (s *Server) confirmReceipt(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	receipt, err := s.store.GetReceipt(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the receipt")
		return
	}

	products, units, companies, err := s.receiptLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}

	in, view, msg := parseReceiptForm(c.PostForm)
	view.ReceiptID = id
	view.ImagePath = receipt.ImagePath
	view.Status = receipt.Status
	view.CompanyID = knownCompanyID(view.CompanyID, companies)
	in.CompanyID = view.CompanyID
	rawJSON, jsonErr := viewToRawJSON(view)
	if jsonErr == nil {
		_ = s.store.UpdateReceiptJSON(id, string(rawJSON))
	}
	if receipt.Status == store.ReceiptMigrated {
		s.renderReceiptReview(c, http.StatusConflict, view, products, units, companies, "This bill is already saved as purchases.")
		return
	}
	if view.CompanyID == 0 && formInt(c.PostForm("company_id")) > 0 {
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, companies, "Choose a company.")
		return
	}
	if msg != "" {
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, companies, msg)
		return
	}
	if jsonErr != nil {
		s.renderReceiptReview(c, http.StatusInternalServerError, view, products, units, companies, "Could not save the product list.")
		return
	}
	res, err := s.store.MigrateReceipt(id, in, string(rawJSON))
	if err != nil {
		msg := "Could not save the purchases."
		if errors.Is(err, store.ErrReceiptMigrated) {
			msg = "This bill is already saved as purchases."
		} else if errors.Is(err, store.ErrReceiptNotReady) {
			msg = "This scan has no product list yet."
		} else if errors.Is(err, store.ErrInvalidUnit) {
			msg = "Choose a unit for each new product."
		} else if errors.Is(err, store.ErrNotFound) {
			msg = "A selected product is gone. Refresh and try again."
		} else if errors.Is(err, store.ErrInvalidCompany) {
			msg = "Choose a company."
		} else if err.Error() == "product name is required" || err.Error() == "name is required" {
			msg = "Name is required for each new product."
		} else if err.Error() == "no products to import" {
			msg = "Tick at least one product."
		}
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, companies, msg)
		return
	}
	c.Redirect(http.StatusSeeOther, "/?imported="+itoa(int64(res.Purchases)))
}

func (s *Server) receiptPreview(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	receipt, err := s.store.GetReceipt(id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	path, ok := s.receiptImagePath(receipt.ImagePath)
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.File(path)
}

func (s *Server) renderReceipts(c *gin.Context, status int, errMsg string) {
	list, err := s.store.ListReceipts()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load receipts")
		return
	}
	c.HTML(status, "receipts.html", gin.H{
		"Page":       s.page("Receipts", "", errMsg),
		"Configured": s.reader.Configured(),
		"Model":      s.receiptModel(),
		"Receipts":   list,
	})
}

func (s *Server) renderReceiptReview(c *gin.Context, status int, view receiptView, products []store.ProductListItem, units []store.Unit, companies []store.Company, errMsg string) {
	c.HTML(status, "receipt_review.html", gin.H{
		"Page":      s.page("Confirm bill", "", errMsg),
		"View":      view,
		"Products":  products,
		"Units":     units,
		"Companies": companies,
	})
}

func (s *Server) receiptLookups() ([]store.ProductListItem, []store.Unit, []store.Company, error) {
	products, err := s.store.ListProducts("")
	if err != nil {
		return nil, nil, nil, err
	}
	units, err := s.store.ListUnits()
	if err != nil {
		return nil, nil, nil, err
	}
	companies, err := s.store.ListCompanies()
	if err != nil {
		return nil, nil, nil, err
	}
	return products, units, companies, nil
}

func (s *Server) receiptModel() string {
	if s.cfg.OCR.Model != "" {
		return s.cfg.OCR.Model
	}
	return ocr.DefaultModel
}

func pickFormFile(c *gin.Context, names ...string) (*multipart.FileHeader, error) {
	var lastErr error
	for _, name := range names {
		fh, err := c.FormFile(name)
		if err != nil {
			lastErr = err
			continue
		}
		if fh != nil && (fh.Filename != "" || fh.Size > 0) {
			return fh, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, http.ErrMissingFile
}
