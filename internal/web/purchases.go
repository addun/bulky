package web

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) newPurchase(c *gin.Context) {
	prod, companies, ok := s.purchaseProduct(c)
	if !ok {
		return
	}
	lastSize, hasLast, err := s.store.LastPackageSize(prod.ID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load pack size")
		return
	}
	s.renderPurchaseForm(c, http.StatusOK, prod, newPurchaseDraft(hasLast, lastSize), companies, true, hasLast, lastSize, c.Query("error"))
}

func (s *Server) createPurchase(c *gin.Context) {
	prod, companies, ok := s.purchaseProduct(c)
	if !ok {
		return
	}
	lastSize, hasLast, err := s.store.LastPackageSize(prod.ID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load pack size")
		return
	}
	form := purchaseFromForm(c)
	renderErr := func(msg string) {
		s.renderPurchaseForm(c, http.StatusUnprocessableEntity, prod, form, companies, true, hasLast, lastSize, msg)
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
	if _, err := s.store.CreatePurchase(prod.ID, companyID, boughtOn, qty, amount, kind, packages, packSize); err != nil {
		renderErr(purchaseSaveError(err))
		return
	}
	c.Redirect(http.StatusSeeOther, "/products/"+itoa(prod.ID))
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
	s.renderPurchaseForm(c, http.StatusOK, prod, p, companies, false, false, decimal.Zero, "")
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
	form := purchaseFromForm(c)
	form.ID = p.ID
	form.ReceiptID = p.ReceiptID
	renderErr := func(msg string) {
		s.renderPurchaseForm(c, http.StatusUnprocessableEntity, prod, form, companies, false, false, decimal.Zero, msg)
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

func (s *Server) purchaseProduct(c *gin.Context) (store.Product, []store.Company, bool) {
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
	companies, err := s.store.ListCompanies()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load companies")
		return store.Product{}, nil, false
	}
	return prod, companies, true
}

func (s *Server) renderPurchaseForm(c *gin.Context, status int, prod store.Product, p store.Purchase, companies []store.Company, isNew bool, hasLast bool, lastSize decimal.Decimal, errMsg string) {
	title := "Add new purchase"
	if !isNew {
		title = editPurchaseTitle(p)
	}
	c.HTML(status, "purchase_form.html", gin.H{
		"Page":         s.page(title, "", errMsg),
		"Product":      prod,
		"Purchase":     p,
		"Companies":    companies,
		"New":          isNew,
		"HasLastPack":  hasLast,
		"LastPackSize": lastSize,
	})
}

func newPurchaseDraft(hasLast bool, lastSize decimal.Decimal) store.Purchase {
	p := store.Purchase{BoughtOn: time.Now().Format("2006-01-02")}
	if hasLast {
		p.PackageCount = decimal.NewFromInt(1)
		p.PackageSize = lastSize
	}
	return p
}

func purchaseFromForm(c *gin.Context) store.Purchase {
	p := store.Purchase{
		BoughtOn:  strings.TrimSpace(c.PostForm("bought_on")),
		Kind:      store.PurchaseKind(c.PostForm("kind")),
		CompanyID: formInt64(c, "company_id"),
	}
	p.Amount, _ = parseDecimal(c.PostForm("amount"), 2, true)
	p.PackageCount, _ = parseDecimal(c.PostForm("packages"), 8, false)
	p.PackageSize, _ = parseDecimal(c.PostForm("package_size"), 8, false)
	return p
}
