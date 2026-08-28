package web

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) createPurchase(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if _, err := s.store.GetProduct(id); errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	} else if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	boughtOn, qty, amount, packages, packSize, msg := s.parsePurchase(c)
	if msg != "" {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape(msg))
		return
	}
	kind, msg := parseKind(c)
	if msg != "" {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape(msg))
		return
	}
	companyID, msg := s.resolveCompanyForm(c)
	if msg != "" {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape(msg))
		return
	}
	if _, err := s.store.CreatePurchase(id, companyID, boughtOn, qty, amount, kind, packages, packSize); err != nil {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape(purchaseSaveError(err)))
		return
	}
	c.Redirect(http.StatusSeeOther, "/products/"+itoa(id))
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
	companies, err := s.store.ListCompanies()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load companies")
		return
	}
	c.HTML(http.StatusOK, "purchase_form.html", gin.H{
		"Page":      s.page(editPurchaseTitle(p), "", ""),
		"Product":   prod,
		"Purchase":  p,
		"Companies": companies,
	})
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
	companies, err := s.store.ListCompanies()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load companies")
		return
	}
	renderErr := func(msg string) {
		c.HTML(http.StatusUnprocessableEntity, "purchase_form.html", gin.H{
			"Page":      s.page(editPurchaseTitle(p), "", msg),
			"Product":   prod,
			"Purchase":  p,
			"Companies": companies,
		})
	}
	boughtOn, qty, amount, packages, packSize, msg := s.parsePurchase(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	kind, msg := parseKind(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	companyID, msg := s.resolveCompanyForm(c)
	if msg != "" {
		renderErr(msg)
		return
	}
	if err := s.store.UpdatePurchase(id, companyID, boughtOn, qty, amount, kind, packages, packSize); err != nil {
		renderErr(purchaseSaveError(err))
		return
	}
	c.Redirect(http.StatusSeeOther, "/products/"+itoa(p.ProductID))
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
		"Page":    s.page("Delete "+noun, "", ""),
		"Title":   "Delete this " + noun + " of " + prod.Name + "?",
		"Body":    body,
		"Action":  "/purchases/" + itoa(id) + "/delete",
		"Cancel":  "/products/" + itoa(p.ProductID),
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
	c.Redirect(http.StatusSeeOther, "/products/"+itoa(p.ProductID))
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
