package web

import (
	"errors"
	"net/http"
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
	formID := int64(0)
	if filter != nil {
		formID = filter.ID
	}
	c.HTML(http.StatusOK, "aliases.html", gin.H{
		"Page":         s.adminPage("Aliases", "", c.Query("error")),
		"Aliases":      list,
		"Filter":       filter,
		"ProductQuery": aliasesQuerySuffix(formID),
	})
}

func (s *Server) newAlias(c *gin.Context) {
	products, stories, chains, err := s.aliasLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	from := formInt64Query(c, "product")
	form := store.ProductAlias{ProductID: from}
	var locked *store.Product
	if from > 0 {
		p, err := s.store.GetProduct(from)
		if errors.Is(err, store.ErrNotFound) {
			c.String(http.StatusNotFound, "not found")
			return
		}
		if err != nil {
			c.String(http.StatusInternalServerError, "could not load product")
			return
		}
		locked = &p
		form.ProductID = p.ID
	}
	s.renderAliasForm(c, http.StatusOK, form, products, stories, chains, from, locked, true, "")
}

func (s *Server) createAlias(c *gin.Context) {
	from := formInt64(c, "from_product")
	form := aliasFormFromPost(c)
	_, err := s.saveAliasFromForm(c, 0)
	if err == nil {
		c.Redirect(http.StatusSeeOther, aliasesPath(from))
		return
	}
	products, stories, chains, lookupErr := s.aliasLookups()
	if lookupErr != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	locked := (*store.Product)(nil)
	if from > 0 {
		if p, perr := s.store.GetProduct(from); perr == nil {
			locked = &p
		}
	}
	msg := aliasFormError(err)
	if msg == "" {
		msg = "Could not save the alias."
	}
	s.renderAliasForm(c, http.StatusUnprocessableEntity, form, products, stories, chains, from, locked, true, msg)
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
	products, stories, chains, err := s.aliasLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	from := formInt64Query(c, "product")
	s.renderAliasForm(c, http.StatusOK, a, products, stories, chains, from, nil, false, "")
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
	products, stories, chains, lookupErr := s.aliasLookups()
	if lookupErr != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	from := formInt64(c, "from_product")
	form := aliasFormFromPost(c)
	form.ID = id
	if msg := aliasFormError(err); msg != "" {
		s.renderAliasForm(c, http.StatusUnprocessableEntity, form, products, stories, chains, from, nil, false, msg)
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
	action := "/admin/aliases/" + itoa(id) + "/delete"
	if q := aliasesQuerySuffix(from); q != "" {
		action += q
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete alias “"+a.Alias+"”?", "", ""),
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

func aliasFormFromPost(c *gin.Context) store.ProductAlias {
	storyID, chainID, _ := parseAliasScope(c.PostForm("scope"))
	return store.ProductAlias{
		ProductID:     formInt64(c, "product_id"),
		StoryID:       storyID,
		RetailChainID: chainID,
		Alias:         strings.TrimSpace(c.PostForm("alias")),
	}
}

func (s *Server) saveAliasFromForm(c *gin.Context, id int64) (store.ProductAlias, error) {
	productID := formInt64(c, "product_id")
	storyID, chainID, err := parseAliasScope(c.PostForm("scope"))
	if err != nil {
		return store.ProductAlias{}, err
	}
	alias := strings.TrimSpace(c.PostForm("alias"))
	if id == 0 {
		return s.store.CreateAlias(productID, storyID, chainID, alias)
	}
	return store.ProductAlias{}, s.store.UpdateAlias(id, productID, storyID, chainID, alias)
}

func parseAliasScope(raw string) (storyID, chainID int64, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, 0, nil
	}
	kind, idStr, ok := strings.Cut(raw, ":")
	if !ok {
		return 0, 0, store.ErrInvalidStory
	}
	n, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || n <= 0 {
		switch kind {
		case "chain":
			return 0, 0, store.ErrInvalidRetailChain
		default:
			return 0, 0, store.ErrInvalidStory
		}
	}
	switch kind {
	case "story":
		return n, 0, nil
	case "chain":
		return 0, n, nil
	default:
		return 0, 0, store.ErrInvalidStory
	}
}

func (s *Server) aliasLookups() ([]store.ProductListItem, []store.Story, []store.RetailChain, error) {
	products, err := s.store.ListProducts("")
	if err != nil {
		return nil, nil, nil, err
	}
	stories, err := s.store.ListStories()
	if err != nil {
		return nil, nil, nil, err
	}
	chains, err := s.store.ListRetailChains()
	if err != nil {
		return nil, nil, nil, err
	}
	return products, stories, chains, nil
}

func aliasFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrInvalidAlias):
		return "Alias is required."
	case errors.Is(err, store.ErrNotFound):
		return "Choose a product."
	case errors.Is(err, store.ErrInvalidStory):
		return "Choose a store."
	case errors.Is(err, store.ErrInvalidRetailChain):
		return "Choose a retail chain."
	case errors.Is(err, store.ErrAliasScope):
		return "Choose either a chain or a store, not both."
	case errors.Is(err, store.ErrDuplicate):
		return "That alias already exists for this scope, or matches a product name."
	default:
		return ""
	}
}

func (s *Server) renderAliasForm(c *gin.Context, status int, a store.ProductAlias, products []store.ProductListItem, stories []store.Story, chains []store.RetailChain, from int64, locked *store.Product, isNew bool, errMsg string) {
	title := "Edit alias"
	if isNew {
		title = "Add alias"
	}
	c.HTML(status, "alias_form.html", gin.H{
		"Page":          s.adminPage(title, "", errMsg),
		"Alias":         a,
		"Products":      products,
		"Stories":       stories,
		"Chains":        chains,
		"FromProduct":   from,
		"LockedProduct": locked,
		"Cancel":        aliasesPath(from),
		"New":           isNew,
	})
}

func aliasesPath(productID int64) string {
	if productID <= 0 {
		return "/admin/aliases"
	}
	return "/admin/aliases?product=" + itoa(productID)
}

func aliasesQuerySuffix(productID int64) string {
	if productID <= 0 {
		return ""
	}
	return "?product=" + itoa(productID)
}
