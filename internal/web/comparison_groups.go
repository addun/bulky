package web

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) comparisonGroups(c *gin.Context) {
	list, err := s.store.ListComparisonGroups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load comparison groups")
		return
	}
	c.HTML(http.StatusOK, "comparison_groups.html", gin.H{
		"Page":   s.adminPage("Comparison groups", "", c.Query("error")),
		"Groups": list,
	})
}

func (s *Server) newComparisonGroup(c *gin.Context) {
	s.renderComparisonGroupForm(c, http.StatusOK, store.ComparisonGroup{}, nil, true, "")
}

func (s *Server) createComparisonGroup(c *gin.Context) {
	name := strings.TrimSpace(c.PostForm("name"))
	unitID := formInt64(c, "unit_id")
	productIDs := formInt64s(c, "product_id")
	form := store.ComparisonGroup{Name: name, UnitID: unitID}
	_, err := s.store.CreateComparisonGroup(name, unitID, productIDs)
	if msg := comparisonGroupFormError(err); msg != "" {
		s.renderComparisonGroupForm(c, http.StatusUnprocessableEntity, form, productIDs, true, msg)
		return
	}
	if err != nil {
		s.renderComparisonGroupForm(c, http.StatusUnprocessableEntity, form, productIDs, true, "Could not save the comparison group.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/comparison-groups")
}

func (s *Server) editComparisonGroup(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	g, err := s.store.GetComparisonGroup(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load comparison group")
		return
	}
	ids, err := s.store.ListComparisonGroupProductIDs(id)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load products")
		return
	}
	s.renderComparisonGroupForm(c, http.StatusOK, g, ids, false, "")
}

func (s *Server) updateComparisonGroup(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if _, err := s.store.GetComparisonGroup(id); errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	} else if err != nil {
		c.String(http.StatusInternalServerError, "could not load comparison group")
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	unitID := formInt64(c, "unit_id")
	productIDs := formInt64s(c, "product_id")
	err := s.store.UpdateComparisonGroup(id, name, unitID, productIDs)
	form := store.ComparisonGroup{ID: id, Name: name, UnitID: unitID}
	if msg := comparisonGroupFormError(err); msg != "" {
		s.renderComparisonGroupForm(c, http.StatusUnprocessableEntity, form, productIDs, false, msg)
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save comparison group")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/comparison-groups")
}

func (s *Server) confirmDeleteComparisonGroup(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	g, err := s.store.GetComparisonGroup(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load comparison group")
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete comparison group", "", ""),
		"Title":   "Delete comparison group “" + g.Name + "”?",
		"Body":    "Products stay in the catalog. They just leave this group.",
		"Action":  "/admin/comparison-groups/" + itoa(id) + "/delete",
		"Cancel":  "/admin/comparison-groups",
		"Confirm": "Delete group",
	})
}

func (s *Server) deleteComparisonGroup(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteComparisonGroup(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete comparison group")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/comparison-groups")
}

func comparisonGroupFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrComparisonGroupName):
		return "Name is required."
	case errors.Is(err, store.ErrInvalidUnit):
		return "Choose a comparison unit."
	case errors.Is(err, store.ErrDuplicate):
		return "A group with that name already exists."
	case errors.Is(err, store.ErrNotFound):
		return "Choose products that still exist."
	default:
		return ""
	}
}

func (s *Server) renderComparisonGroupForm(c *gin.Context, status int, g store.ComparisonGroup, selectedIDs []int64, isNew bool, errMsg string) {
	units, err := s.store.ListUnits()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load units")
		return
	}
	products, err := s.store.ListProducts("")
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load products")
		return
	}
	title := "Edit comparison group"
	if isNew {
		title = "Add comparison group"
	}
	c.HTML(status, "comparison_group_form.html", gin.H{
		"Page":     s.adminPage(title, "", errMsg),
		"Group":    g,
		"New":      isNew,
		"Units":    units,
		"Products": productOptions(products, selectedIDs),
	})
}

type productOption struct {
	store.ProductListItem
	Selected bool
}

func productOptions(products []store.ProductListItem, selectedIDs []int64) []productOption {
	want := map[int64]bool{}
	for _, id := range selectedIDs {
		want[id] = true
	}
	out := make([]productOption, len(products))
	for i, p := range products {
		out[i] = productOption{ProductListItem: p, Selected: want[p.ID]}
	}
	return out
}

type groupOption struct {
	store.ComparisonGroup
	Selected bool
}

func (s *Server) comparisonGroupOptions(selectedIDs []int64) ([]groupOption, error) {
	groups, err := s.store.ListComparisonGroups()
	if err != nil {
		return nil, err
	}
	want := map[int64]bool{}
	for _, id := range selectedIDs {
		want[id] = true
	}
	out := make([]groupOption, len(groups))
	for i, g := range groups {
		out[i] = groupOption{ComparisonGroup: g, Selected: want[g.ID]}
	}
	return out, nil
}

func (s *Server) selectedGroupIDs(productID int64) ([]int64, error) {
	if productID == 0 {
		return nil, nil
	}
	groups, err := s.store.ListComparisonGroupsForProduct(productID)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, len(groups))
	for i, g := range groups {
		ids[i] = g.ID
	}
	return ids, nil
}
