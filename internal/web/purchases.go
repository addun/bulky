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
	boughtOn, qty, amount, msg := s.parsePurchase(c)
	if msg != "" {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape(msg))
		return
	}
	if _, err := s.store.CreatePurchase(id, boughtOn, qty, amount); err != nil {
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(id)+"?error="+url.QueryEscape("Could not save the purchase."))
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
	c.HTML(http.StatusOK, "purchase_form.html", gin.H{
		"Page":     s.page("Edit purchase", "", ""),
		"Product":  prod,
		"Purchase": p,
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
	boughtOn, qty, amount, msg := s.parsePurchase(c)
	if msg != "" {
		c.HTML(http.StatusUnprocessableEntity, "purchase_form.html", gin.H{
			"Page":     s.page("Edit purchase", "", msg),
			"Product":  prod,
			"Purchase": p,
		})
		return
	}
	if err := s.store.UpdatePurchase(id, boughtOn, qty, amount); err != nil {
		c.HTML(http.StatusUnprocessableEntity, "purchase_form.html", gin.H{
			"Page":     s.page("Edit purchase", "", "Could not save the purchase."),
			"Product":  prod,
			"Purchase": p,
		})
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
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.page("Delete purchase", "", ""),
		"Title":   "Delete this purchase of " + prod.Name + "?",
		"Body":    "The product stays. Only this buy is removed from the history.",
		"Action":  "/purchases/" + itoa(id) + "/delete",
		"Cancel":  "/products/" + itoa(p.ProductID),
		"Confirm": "Delete purchase",
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
