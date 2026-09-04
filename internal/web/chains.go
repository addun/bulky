package web

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) retailChains(c *gin.Context) {
	list, err := s.store.ListRetailChains()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load retail chains")
		return
	}
	c.HTML(http.StatusOK, "retail_chains.html", gin.H{
		"Page":         s.adminPage("Retail chains", "", c.Query("error")),
		"RetailChains": list,
	})
}

func (s *Server) newRetailChain(c *gin.Context) {
	s.renderRetailChainForm(c, http.StatusOK, store.RetailChain{}, true, "")
}

func (s *Server) createRetailChain(c *gin.Context) {
	name, legal, tax := retailChainFields(c)
	form := store.RetailChain{Name: name, LegalName: legal, TaxID: tax}
	_, err := s.store.CreateRetailChain(name, legal, tax)
	if msg := retailChainFormError(err); msg != "" {
		s.renderRetailChainForm(c, http.StatusUnprocessableEntity, form, true, msg)
		return
	}
	if err != nil {
		s.renderRetailChainForm(c, http.StatusUnprocessableEntity, form, true, "Could not save the retail chain.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/retail-chains")
}

func (s *Server) editRetailChain(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	chain, err := s.store.GetRetailChain(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load retail chain")
		return
	}
	s.renderRetailChainForm(c, http.StatusOK, chain, false, "")
}

func (s *Server) updateRetailChain(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	name, legal, tax := retailChainFields(c)
	err := s.store.UpdateRetailChain(id, name, legal, tax)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	form := store.RetailChain{ID: id, Name: name, LegalName: legal, TaxID: tax}
	if msg := retailChainFormError(err); msg != "" {
		s.renderRetailChainForm(c, http.StatusUnprocessableEntity, form, false, msg)
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save retail chain")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/retail-chains")
}

func (s *Server) confirmDeleteRetailChain(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	chain, err := s.store.GetRetailChain(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load retail chain")
		return
	}
	if chain.StoryCount > 0 {
		c.Redirect(http.StatusSeeOther, "/admin/retail-chains?error="+url.QueryEscape("Cannot delete “"+chain.Name+"” while a store still uses it."))
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete retail chain", "", ""),
		"Title":   "Delete retail chain “" + chain.Name + "”?",
		"Body":    "This only removes the chain from the list. No stores use it.",
		"Action":  "/admin/retail-chains/" + itoa(id) + "/delete",
		"Cancel":  "/admin/retail-chains",
		"Confirm": "Delete chain",
	})
}

func (s *Server) deleteRetailChain(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteRetailChain(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, store.ErrRetailChainInUse) {
		c.Redirect(http.StatusSeeOther, "/admin/retail-chains?error="+url.QueryEscape("Cannot delete a retail chain while a store still uses it."))
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete retail chain")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/retail-chains")
}

func retailChainFields(c *gin.Context) (name, legalName, taxID string) {
	return strings.TrimSpace(c.PostForm("name")),
		strings.TrimSpace(c.PostForm("legal_name")),
		strings.TrimSpace(c.PostForm("tax_id"))
}

func retailChainFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrRetailChainName):
		return "Name is required."
	case errors.Is(err, store.ErrRetailChainLegalName):
		return "Legal name is required."
	case errors.Is(err, store.ErrRetailChainTaxID):
		return "Tax ID is required."
	case errors.Is(err, store.ErrDuplicate):
		return "A chain with that name or tax ID already exists."
	case errors.Is(err, store.ErrInvalidRetailChain):
		return "Choose a retail chain."
	default:
		return ""
	}
}

func (s *Server) renderRetailChainForm(c *gin.Context, status int, chain store.RetailChain, isNew bool, errMsg string) {
	title := "Edit retail chain"
	if isNew {
		title = "Add retail chain"
	}
	c.HTML(status, "retail_chain_form.html", gin.H{
		"Page":        s.adminPage(title, "", errMsg),
		"RetailChain": chain,
		"New":         isNew,
	})
}
