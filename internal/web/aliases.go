package web

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) aliases(c *gin.Context) {
	productID := formInt64Query(c, "product")
	var filter *store.Product
	if productID > 0 {
		p, err := s.store.GetProduct(productID)
		if errors.Is(err, store.ErrNotFound) {
			c.String(http.StatusNotFound, "not found")
			return
		}
		if err != nil {
			c.String(http.StatusInternalServerError, "could not load product")
			return
		}
		filter = &p
	}
	var list []store.ProductAlias
	var err error
	if filter != nil {
		list, err = s.store.ListAliasesByProduct(filter.ID)
	} else {
		list, err = s.store.ListAliases()
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load aliases")
		return
	}
	products, companies, err := s.aliasLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	formID := int64(0)
	if filter != nil {
		formID = filter.ID
	}
	c.HTML(http.StatusOK, "aliases.html", gin.H{
		"Page":         s.page("Aliases", "", c.Query("error")),
		"Aliases":      list,
		"Products":     products,
		"Companies":    companies,
		"Filter":       filter,
		"ProductQuery": aliasesQuerySuffix(formID),
		"Form":         store.ProductAlias{ProductID: formID},
	})
}

func (s *Server) createAlias(c *gin.Context) {
	from := formInt64(c, "from_product")
	redirect := aliasRedirect(c.PostForm("redirect"))
	if strings.TrimSpace(c.PostForm("redirect")) == "" {
		redirect = aliasesPath(from)
	}
	_, err := s.saveAliasFromForm(c, 0)
	if msg := aliasFormError(err); msg != "" {
		c.Redirect(http.StatusSeeOther, aliasesPathError(redirect, msg))
		return
	}
	if err != nil {
		c.Redirect(http.StatusSeeOther, aliasesPathError(redirect, "Could not save the alias."))
		return
	}
	c.Redirect(http.StatusSeeOther, redirect)
}

func (s *Server) editAlias(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	a, err := s.store.GetAlias(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load alias")
		return
	}
	products, companies, err := s.aliasLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	from := formInt64Query(c, "product")
	c.HTML(http.StatusOK, "alias_form.html", gin.H{
		"Page":        s.page("Edit alias", "", ""),
		"Alias":       a,
		"Products":    products,
		"Companies":   companies,
		"FromProduct": from,
		"Cancel":      aliasesPath(from),
	})
}

func (s *Server) updateAlias(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if _, err := s.store.GetAlias(id); errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	} else if err != nil {
		c.String(http.StatusInternalServerError, "could not load alias")
		return
	}
	_, err := s.saveAliasFromForm(c, id)
	products, companies, lookupErr := s.aliasLookups()
	if lookupErr != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	from := formInt64(c, "from_product")
	form := store.ProductAlias{
		ID:        id,
		ProductID: formInt64(c, "product_id"),
		CompanyID: formInt64(c, "company_id"),
		Alias:     strings.TrimSpace(c.PostForm("alias")),
	}
	if msg := aliasFormError(err); msg != "" {
		c.HTML(http.StatusUnprocessableEntity, "alias_form.html", gin.H{
			"Page":        s.page("Edit alias", "", msg),
			"Alias":       form,
			"Products":    products,
			"Companies":   companies,
			"FromProduct": from,
			"Cancel":      aliasesPath(from),
		})
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save alias")
		return
	}
	c.Redirect(http.StatusSeeOther, aliasesPath(from))
}

func (s *Server) confirmDeleteAlias(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	a, err := s.store.GetAlias(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load alias")
		return
	}
	from := formInt64Query(c, "product")
	action := "/aliases/" + itoa(id) + "/delete"
	if q := aliasesQuerySuffix(from); q != "" {
		action += q
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.page("Delete alias", "", ""),
		"Title":   "Delete alias “" + a.Alias + "”?",
		"Body":    "This only removes the alternate name. The product stays.",
		"Action":  action,
		"Cancel":  aliasesPath(from),
		"Confirm": "Delete alias",
	})
}

func (s *Server) deleteAlias(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteAlias(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete alias")
		return
	}
	c.Redirect(http.StatusSeeOther, aliasesPath(formInt64Query(c, "product")))
}

func (s *Server) saveAliasFromForm(c *gin.Context, id int64) (store.ProductAlias, error) {
	productID := formInt64(c, "product_id")
	companyID := formInt64(c, "company_id")
	alias := strings.TrimSpace(c.PostForm("alias"))
	if id == 0 {
		return s.store.CreateAlias(productID, companyID, alias)
	}
	return store.ProductAlias{}, s.store.UpdateAlias(id, productID, companyID, alias)
}

func (s *Server) aliasLookups() ([]store.ProductListItem, []store.Company, error) {
	products, err := s.store.ListProducts("")
	if err != nil {
		return nil, nil, err
	}
	companies, err := s.store.ListCompanies()
	if err != nil {
		return nil, nil, err
	}
	return products, companies, nil
}

func aliasFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrInvalidAlias):
		return "Alias is required."
	case errors.Is(err, store.ErrNotFound):
		return "Choose a product."
	case errors.Is(err, store.ErrInvalidCompany):
		return "Choose a company."
	case errors.Is(err, store.ErrDuplicate):
		return "That alias already exists for this shop, or matches a product name."
	default:
		return ""
	}
}

func aliasRedirect(raw string) string {
	r := strings.TrimSpace(raw)
	rest, ok := strings.CutPrefix(r, "/products/")
	if !ok {
		return "/aliases"
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || id <= 0 || rest != strconv.FormatInt(id, 10) {
		return "/aliases"
	}
	return r
}

func aliasesPath(productID int64) string {
	if productID <= 0 {
		return "/aliases"
	}
	return "/aliases?product=" + itoa(productID)
}

func aliasesQuerySuffix(productID int64) string {
	if productID <= 0 {
		return ""
	}
	return "?product=" + itoa(productID)
}

func aliasesPathError(path, msg string) string {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return path + sep + "error=" + url.QueryEscape(msg)
}
