package web

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) newPurchase(c *gin.Context) {
	prod, stories, ok := s.purchaseProduct(c)
	if !ok {
		return
	}
	s.renderPurchaseForm(c, http.StatusOK, prod, newPurchaseDraft(), stories, true, c.Query("error"))
}

func (s *Server) createPurchase(c *gin.Context) {
	prod, stories, ok := s.purchaseProduct(c)
	if !ok {
		return
	}
	form := purchaseFromForm(c)
	renderErr := func(msg string) {
		s.renderPurchaseForm(c, http.StatusUnprocessableEntity, prod, form, stories, true, msg)
	}
	boughtOn, qty, amount, msg := s.parsePurchase(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	kind, msg := parseKind(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	storyID, msg := s.resolveStoryForm(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	if _, err := s.store.CreatePurchase(prod.ID, storyID, boughtOn, qty, amount, kind); err != nil {
		renderErr(purchaseSaveError(err))
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(prod.ID))
}

func (s *Server) editPurchase(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetPurchase(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchase")
		return
	}
	prod, err := s.store.GetProduct(p.ProductID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	s.renderPurchaseForm(c, http.StatusOK, prod, p, stories, false, "")
}

func (s *Server) updatePurchase(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetPurchase(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchase")
		return
	}
	prod, err := s.store.GetProduct(p.ProductID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	form := purchaseFromForm(c)
	form.ID = p.ID
	form.ReceiptID = p.ReceiptID
	renderErr := func(msg string) {
		s.renderPurchaseForm(c, http.StatusUnprocessableEntity, prod, form, stories, false, msg)
	}
	boughtOn, qty, amount, msg := s.parsePurchase(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	kind, msg := parseKind(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	storyID, msg := s.resolveStoryForm(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	if err := s.store.UpdatePurchase(id, storyID, boughtOn, qty, amount, kind); err != nil {
		renderErr(purchaseSaveError(err))
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(p.ProductID))
}

func (s *Server) confirmDeletePurchase(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetPurchase(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchase")
		return
	}
	prod, err := s.store.GetProduct(p.ProductID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	noun := "purchase"
	body := "The product stays. Only this buy is removed from the history."
	if p.IsPrice() {
		noun = "price"
		body = "The product stays. Only this price is removed from the history."
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete "+noun, "", ""),
		"Title":   "Delete this " + noun + " of " + prod.Name + "?",
		"Body":    body,
		"Action":  "/admin/purchases/" + itoa(id) + "/delete",
		"Cancel":  "/admin/products/" + itoa(p.ProductID),
		"Confirm": "Delete " + noun,
	})
}

func (s *Server) deletePurchase(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetPurchase(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchase")
		return
	}
	if err := s.store.DeletePurchase(id); err != nil {
		c.String(http.StatusInternalServerError, "could not delete")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(p.ProductID))
}

func parseKind(c *gin.Context) (store.PurchaseKind, string) {
	k, err := store.ParsePurchaseKind(c.PostForm("kind"))
	if err != nil {
		return "", "Choose purchase or price."
	}
	return k, ""
}

func editPurchaseTitle(p store.Purchase) string {
	if p.IsPrice() {
		return "Edit price"
	}
	return "Edit purchase"
}

func (s *Server) purchaseProduct(c *gin.Context) (store.Product, []store.Story, bool) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return store.Product{}, nil, false
	}
	prod, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return store.Product{}, nil, false
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return store.Product{}, nil, false
	}
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return store.Product{}, nil, false
	}
	return prod, stories, true
}

func (s *Server) renderPurchaseForm(c *gin.Context, status int, prod store.Product, p store.Purchase, stories []store.Story, isNew bool, errMsg string) {
	title := "Add new purchase"
	if !isNew {
		title = editPurchaseTitle(p)
	}
	c.HTML(status, "purchase_form.html", gin.H{
		"Page":     s.adminPage(title, "", errMsg),
		"Product":  prod,
		"Purchase": p,
		"Stories":  stories,
		"New":      isNew,
	})
}

func newPurchaseDraft() store.Purchase {
	return store.Purchase{BoughtOn: time.Now().Format("2006-01-02 15:04")}
}

func purchaseFromForm(c *gin.Context) store.Purchase {
	p := store.Purchase{
		BoughtOn: store.JoinBoughtOn(c.PostForm("bought_on"), c.PostForm("bought_at")),
		Kind:     store.PurchaseKind(c.PostForm("kind")),
		StoryID:  formInt64(c, "story_id"),
	}
	p.Amount, _ = parseDecimal(c.PostForm("amount"), 2, true)
	p.Quantity, _ = parseDecimal(c.PostForm("quantity"), 8, false)
	return p
}
