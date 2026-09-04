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
		c.Redirect(http.StatusSeeOther, "/admin/receipts?error="+url.QueryEscape("Set OCR_API_KEY or OCR_BASE_URL so the reader can run."))
		return
	}
	model, err := s.ocrModel()
	if err != nil {
		s.renderReceipts(c, http.StatusInternalServerError, "Could not load settings.")
		return
	}
	if model == "" {
		c.Redirect(http.StatusSeeOther, "/admin/receipts?error="+url.QueryEscape("Set the AI model under Admin so the reader can run."))
		return
	}
	fh, err := pickFormFile(c, "bill", "bill_camera")
	if err != nil {
		s.renderReceipts(c, http.StatusUnprocessableEntity, "Choose a photo or a PDF of the bill.")
		return
	}

	receipt, msg, status := s.acceptBillUpload(fh)
	if msg != "" {
		s.renderReceipts(c, status, msg)
		return
	}
	s.enqueueOCR(receipt.ID)
	c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(receipt.ID))
}

// acceptBillUpload stores one file as a pending receipt. A later multi-file
// POST can call this once per file, enqueue each id, and send the user to
// the list (or the first receipt).
func (s *Server) acceptBillUpload(fh *multipart.FileHeader) (store.Receipt, string, int) {
	if fh.Size > ocr.MaxImageBytes {
		return store.Receipt{}, "File must be 10 MB or smaller.", http.StatusUnprocessableEntity
	}
	f, err := fh.Open()
	if err != nil {
		return store.Receipt{}, "Could not read the file.", http.StatusUnprocessableEntity
	}
	raw, err := io.ReadAll(io.LimitReader(f, ocr.MaxImageBytes+1))
	f.Close()
	if err != nil {
		return store.Receipt{}, "Could not read the file.", http.StatusUnprocessableEntity
	}
	if int64(len(raw)) > ocr.MaxImageBytes {
		return store.Receipt{}, "File must be 10 MB or smaller.", http.StatusUnprocessableEntity
	}

	jpeg, err := ocr.PreviewJPEG(raw)
	if err != nil {
		return store.Receipt{}, strings.TrimSuffix(err.Error(), ".") + ".", http.StatusUnprocessableEntity
	}
	imagePath, err := s.saveReceiptFiles(raw, jpeg)
	if err != nil {
		return store.Receipt{}, "Could not store the bill.", http.StatusInternalServerError
	}

	receipt, err := s.store.CreateReceipt(imagePath)
	if err != nil {
		s.deleteReceiptFiles(imagePath)
		return store.Receipt{}, "Could not save the receipt.", http.StatusInternalServerError
	}
	return receipt, "", 0
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
	if receipt.Status == store.ReceiptPending || receipt.Status == store.ReceiptFailed {
		s.renderReceiptStatus(c, http.StatusOK, receipt, c.Query("error"))
		return
	}
	if receipt.Status == store.ReceiptMigrated {
		s.renderReceiptShow(c, http.StatusOK, receipt, c.Query("error"))
		return
	}
	products, units, stories, err := s.receiptLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	aliases, err := s.store.ListAliases()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load aliases")
		return
	}
	view, err := receiptToView(receipt, products, units, stories, aliases)
	if err != nil {
		s.renderReceipts(c, http.StatusInternalServerError, "Could not read the saved AI response.")
		return
	}
	s.renderReceiptReview(c, http.StatusOK, view, products, units, stories, c.Query("error"))
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

	products, units, stories, err := s.receiptLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}

	in, view, msg := parseReceiptForm(c.PostForm, products)
	view.ReceiptID = id
	view.ImagePath = receipt.ImagePath
	view.Status = receipt.Status
	view.StoryID = knownStoryID(view.StoryID, stories)
	in.StoryID = view.StoryID
	rawJSON, jsonErr := viewToRawJSON(view)
	if jsonErr == nil {
		_ = s.store.UpdateReceiptJSON(id, string(rawJSON))
	}
	if receipt.Status == store.ReceiptMigrated {
		s.renderReceiptShow(c, http.StatusConflict, receipt, "This bill is already saved as purchases.")
		return
	}
	if view.StoryID == 0 && formInt(c.PostForm("story_id")) > 0 {
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, stories, "Choose a store.")
		return
	}
	if msg != "" {
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, stories, msg)
		return
	}
	if jsonErr != nil {
		s.renderReceiptReview(c, http.StatusInternalServerError, view, products, units, stories, "Could not save the product list.")
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
		} else if errors.Is(err, store.ErrInvalidStory) {
			msg = "Choose a store."
		} else if err.Error() == "product name is required" || err.Error() == "name is required" {
			msg = "Name is required for each new product."
		} else if err.Error() == "no products to import" {
			msg = "Tick at least one product."
		}
		s.renderReceiptReview(c, http.StatusUnprocessableEntity, view, products, units, stories, msg)
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?imported="+itoa(int64(res.Purchases)))
}

func (s *Server) editReceipt(c *gin.Context) {
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
	if receipt.Status != store.ReceiptMigrated {
		c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
		return
	}
	s.renderReceiptEdit(c, http.StatusOK, receipt, "", 0, c.Query("error"))
}

func (s *Server) updateReceiptVisit(c *gin.Context) {
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
	if receipt.Status != store.ReceiptMigrated {
		c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
		return
	}
	boughtOn, err := store.NormalizeBoughtOn(store.JoinBoughtOn(c.PostForm("bought_on"), c.PostForm("bought_at")))
	storyID, msg := s.resolveStoryForm(c)
	if err != nil {
		s.renderReceiptEdit(c, http.StatusUnprocessableEntity, receipt, store.JoinBoughtOn(c.PostForm("bought_on"), c.PostForm("bought_at")), storyID, "Date must be a valid day.")
		return
	}
	if msg != "" {
		s.renderReceiptEdit(c, http.StatusUnprocessableEntity, receipt, boughtOn, storyID, msg)
		return
	}
	if err := s.store.UpdateReceiptVisit(id, storyID, boughtOn); err != nil {
		msg := "Could not save the visit."
		if errors.Is(err, store.ErrInvalidStory) {
			msg = "Choose a store."
		} else if errors.Is(err, store.ErrReceiptNotReady) {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
			return
		}
		s.renderReceiptEdit(c, http.StatusUnprocessableEntity, receipt, boughtOn, storyID, msg)
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
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
	model, err := s.ocrModel()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load settings")
		return
	}
	c.HTML(status, "receipts.html", gin.H{
		"Page":       s.adminPage("Receipts", "", errMsg),
		"Configured": s.reader.Configured(),
		"Model":      model,
		"Receipts":   list,
	})
}

func (s *Server) renderReceiptReview(c *gin.Context, status int, view receiptView, products []store.ProductListItem, units []store.Unit, stories []store.Story, errMsg string) {
	c.HTML(status, "receipt_review.html", gin.H{
		"Page":     s.adminPage("Confirm bill", "", errMsg),
		"View":     view,
		"Products": products,
		"Units":    units,
		"Stories":  stories,
	})
}

func (s *Server) retryReceipt(c *gin.Context) {
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
	if receipt.Status != store.ReceiptFailed && receipt.Status != store.ReceiptPending {
		c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
		return
	}
	if receipt.Status == store.ReceiptFailed {
		if !s.reader.Configured() {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?error="+url.QueryEscape("Set OCR_API_KEY or OCR_BASE_URL so the reader can run."))
			return
		}
		model, err := s.ocrModel()
		if err != nil {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?error="+url.QueryEscape("Could not load settings."))
			return
		}
		if model == "" {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?error="+url.QueryEscape("Set the AI model under Admin so the reader can run."))
			return
		}
		if _, err := s.loadReceiptSource(receipt.ImagePath); err != nil {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?error="+url.QueryEscape("This bill is no longer on disk. Upload it again from Receipts."))
			return
		}
		if err := s.store.RequeueReceipt(id); err != nil {
			c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id)+"?error="+url.QueryEscape("Could not start reading again."))
			return
		}
	}
	s.enqueueOCR(id)
	c.Redirect(http.StatusSeeOther, "/admin/receipts/"+itoa(id))
}

func (s *Server) renderReceiptStatus(c *gin.Context, status int, receipt store.Receipt, errMsg string) {
	page := s.adminPage("Receipt", "", errMsg)
	if receipt.Reading() {
		page.RefreshSeconds = 3
	}
	c.HTML(status, "receipt_status.html", gin.H{
		"Page":    page,
		"Receipt": receipt,
	})
}

func (s *Server) renderReceiptShow(c *gin.Context, status int, receipt store.Receipt, errMsg string) {
	buys, err := s.store.ListPurchasesByReceipt(receipt.ID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchases")
		return
	}
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	boughtOn, boughtAt, notes, story := receiptVisitFacts(receipt, buys, stories)
	if boughtAt == "" {
		boughtAt = store.BoughtOnTime(boughtOn)
	}
	boughtOn = store.JoinBoughtOn(boughtOn, boughtAt)
	imported := int(formInt64Query(c, "imported"))
	c.HTML(status, "receipt_show.html", gin.H{
		"Page":      s.adminPage("Receipt", "", errMsg),
		"Receipt":   receipt,
		"Purchases": buys,
		"BoughtOn":  boughtOn,
		"BoughtAt":  boughtAt,
		"Notes":     notes,
		"Story":     story,
		"Imported":  imported,
	})
}

func (s *Server) renderReceiptEdit(c *gin.Context, status int, receipt store.Receipt, boughtOn string, storyID int64, errMsg string) {
	buys, err := s.store.ListPurchasesByReceipt(receipt.ID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchases")
		return
	}
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	var boughtAt string
	if boughtOn == "" && storyID == 0 {
		var story store.Story
		boughtOn, boughtAt, _, story = receiptVisitFacts(receipt, buys, stories)
		storyID = story.ID
	} else {
		_, boughtAt, _, _ = receiptVisitFacts(receipt, buys, stories)
	}
	if boughtAt == "" {
		boughtAt = store.BoughtOnTime(boughtOn)
	}
	boughtOn = store.JoinBoughtOn(boughtOn, boughtAt)
	c.HTML(status, "receipt_edit.html", gin.H{
		"Page":     s.adminPage("Edit visit", "", errMsg),
		"Receipt":  receipt,
		"BoughtOn": boughtOn,
		"BoughtAt": boughtAt,
		"Story":    storyByID(stories, storyID),
		"Stories":  stories,
	})
}

func (s *Server) receiptLookups() ([]store.ProductListItem, []store.Unit, []store.Story, error) {
	products, err := s.store.ListProducts("")
	if err != nil {
		return nil, nil, nil, err
	}
	units, err := s.store.ListUnits()
	if err != nil {
		return nil, nil, nil, err
	}
	stories, err := s.store.ListStories()
	if err != nil {
		return nil, nil, nil, err
	}
	return products, units, stories, nil
}

func (s *Server) ocrModel() (string, error) {
	return s.store.GetSetting(store.SettingOCRModel)
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
