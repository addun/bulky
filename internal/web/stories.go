package web

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) stories(c *gin.Context) {
	list, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	c.HTML(http.StatusOK, "stories.html", gin.H{
		"Page":    s.adminPage("Stores", "", c.Query("error")),
		"Stories": list,
	})
}

func (s *Server) newStory(c *gin.Context) {
	s.renderStoryForm(c, http.StatusOK, storyFromQuery(c), true, "", receiptReturnPath(c.Query("next")))
}

func (s *Server) createStory(c *gin.Context) {
	name, street, building, apartment, postal, city, externalID := storyFields(c)
	chainID := formInt64(c, "retail_chain_id")
	form := store.Story{Name: name, StreetName: street, BuildingNumber: building, ApartmentNumber: apartment, PostalCode: postal, City: city, ExternalID: externalID, RetailChainID: chainID}
	next := receiptReturnPath(c.PostForm("next"))
	_, err := s.store.CreateStory(name, street, building, apartment, postal, city, externalID, chainID)
	if msg := storyFormError(err); msg != "" {
		s.renderStoryForm(c, http.StatusUnprocessableEntity, form, true, msg, next)
		return
	}
	if err != nil {
		s.renderStoryForm(c, http.StatusUnprocessableEntity, form, true, "Could not save the store.", next)
		return
	}
	if next != "" {
		c.Redirect(http.StatusSeeOther, next)
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/stories")
}

func (s *Server) editStory(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	co, err := s.store.GetStory(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load store")
		return
	}
	s.renderStoryForm(c, http.StatusOK, co, false, "", "")
}

func (s *Server) updateStory(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	name, street, building, apartment, postal, city, externalID := storyFields(c)
	chainID := formInt64(c, "retail_chain_id")
	err := s.store.UpdateStory(id, name, street, building, apartment, postal, city, externalID, chainID)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	form := store.Story{ID: id, Name: name, StreetName: street, BuildingNumber: building, ApartmentNumber: apartment, PostalCode: postal, City: city, ExternalID: externalID, RetailChainID: chainID}
	if msg := storyFormError(err); msg != "" {
		s.renderStoryForm(c, http.StatusUnprocessableEntity, form, false, msg, "")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save store")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/stories")
}

func (s *Server) confirmDeleteStory(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	co, err := s.store.GetStory(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load store")
		return
	}
	if co.PurchaseCount > 0 {
		c.Redirect(http.StatusSeeOther, "/admin/stories?error="+url.QueryEscape("Cannot delete “"+co.Name+"” while a purchase still uses it."))
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete store", "", ""),
		"Title":   "Delete store “" + co.Name + "”?",
		"Body":    "This only removes the store from the list. No purchases use it.",
		"Action":  "/admin/stories/" + itoa(id) + "/delete",
		"Cancel":  "/admin/stories",
		"Confirm": "Delete store",
	})
}

func (s *Server) deleteStory(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteStory(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, store.ErrStoryInUse) {
		c.Redirect(http.StatusSeeOther, "/admin/stories?error="+url.QueryEscape("Cannot delete a store while a purchase still uses it."))
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete store")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/stories")
}

func (s *Server) resolveStoryForm(c *gin.Context) (int64, string) {
	id := formInt64(c, "story_id")
	if id <= 0 {
		return 0, ""
	}
	if _, err := s.store.GetStory(id); errors.Is(err, store.ErrNotFound) {
		return 0, "Choose a store."
	} else if err != nil {
		return 0, "Could not load the store."
	}
	return id, ""
}

func storyFields(c *gin.Context) (name, street, building, apartment, postal, city, externalID string) {
	return strings.TrimSpace(c.PostForm("name")),
		strings.TrimSpace(c.PostForm("street_name")),
		strings.TrimSpace(c.PostForm("building_number")),
		strings.TrimSpace(c.PostForm("apartment_number")),
		strings.TrimSpace(c.PostForm("postal_code")),
		strings.TrimSpace(c.PostForm("city")),
		strings.TrimSpace(c.PostForm("external_id"))
}

func storyFromQuery(c *gin.Context) store.Story {
	q := func(field string) string {
		return strings.TrimSpace(c.Query(prefillQuery(field)))
	}
	return store.Story{
		Name:            q("name"),
		StreetName:      q("street_name"),
		BuildingNumber:  q("building_number"),
		ApartmentNumber: q("apartment_number"),
		PostalCode:      q("postal_code"),
		City:            q("city"),
		ExternalID:      q("external_id"),
	}
}

func prefillQuery(field string) string {
	return "prefill[" + field + "]"
}

func receiptReturnPath(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u.IsAbs() || u.Host != "" || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	path := u.Path
	if !strings.HasPrefix(path, "/admin/receipts/") {
		return ""
	}
	id := strings.TrimPrefix(path, "/admin/receipts/")
	if id == "" || strings.ContainsAny(id, "/.") {
		return ""
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return "/admin/receipts/" + id
}

func storyFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrStoryName):
		return "Name is required."
	case errors.Is(err, store.ErrStoryStreet):
		return "Street name is required."
	case errors.Is(err, store.ErrStoryBuilding):
		return "Building number is required."
	case errors.Is(err, store.ErrStoryPostal):
		return "Postal code is required."
	case errors.Is(err, store.ErrStoryCity):
		return "City is required."
	case errors.Is(err, store.ErrInvalidStory):
		return "Choose a store."
	case errors.Is(err, store.ErrInvalidRetailChain):
		return "Choose a retail chain."
	case errors.Is(err, store.ErrDuplicate):
		return "That store code is already used."
	default:
		return ""
	}
}

func storiesByID(list []store.Story) map[int64]store.Story {
	m := make(map[int64]store.Story, len(list))
	for _, c := range list {
		m[c.ID] = c
	}
	return m
}

func (s *Server) renderStoryForm(c *gin.Context, status int, co store.Story, isNew bool, errMsg, next string) {
	title := "Edit store"
	if isNew {
		title = "Add store"
	}
	chains, err := s.store.ListRetailChains()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load retail chains")
		return
	}
	c.HTML(status, "story_form.html", gin.H{
		"Page":         s.adminPage(title, "", errMsg),
		"Story":        co,
		"RetailChains": chains,
		"New":          isNew,
		"Next":         next,
	})
}
