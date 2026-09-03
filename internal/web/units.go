package web

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) units(c *gin.Context) {
	list, err := s.store.ListUnits()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load units")
		return
	}
	c.HTML(http.StatusOK, "units.html", gin.H{
		"Page":  s.adminPage("Units", "", c.Query("error")),
		"Units": list,
	})
}

func (s *Server) createUnit(c *gin.Context) {
	_, err := s.store.CreateUnit(c.PostForm("name"))
	if errors.Is(err, store.ErrInvalidUnit) {
		c.Redirect(http.StatusSeeOther, "/admin/units?error="+url.QueryEscape("Name is required."))
		return
	}
	if errors.Is(err, store.ErrDuplicate) {
		c.Redirect(http.StatusSeeOther, "/admin/units?error="+url.QueryEscape("That unit already exists."))
		return
	}
	if err != nil {
		c.Redirect(http.StatusSeeOther, "/admin/units?error="+url.QueryEscape("Could not save the unit."))
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/units")
}

func (s *Server) editUnit(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	u, err := s.store.GetUnit(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load unit")
		return
	}
	c.HTML(http.StatusOK, "unit_form.html", gin.H{
		"Page": s.adminPage("Rename unit", "", ""),
		"Unit": u,
	})
}

func (s *Server) updateUnit(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.UpdateUnit(id, c.PostForm("name"))
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, store.ErrInvalidUnit) {
		c.HTML(http.StatusUnprocessableEntity, "unit_form.html", gin.H{
			"Page": s.adminPage("Rename unit", "", "Name is required."),
			"Unit": store.Unit{ID: id, Name: strings.TrimSpace(c.PostForm("name"))},
		})
		return
	}
	if errors.Is(err, store.ErrDuplicate) {
		c.HTML(http.StatusUnprocessableEntity, "unit_form.html", gin.H{
			"Page": s.adminPage("Rename unit", "", "That unit already exists."),
			"Unit": store.Unit{ID: id, Name: strings.TrimSpace(c.PostForm("name"))},
		})
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save unit")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/units")
}

func (s *Server) confirmDeleteUnit(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	u, err := s.store.GetUnit(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load unit")
		return
	}
	if u.ProductCount > 0 {
		c.Redirect(http.StatusSeeOther, "/admin/units?error="+url.QueryEscape("Cannot delete “"+u.Name+"” while a product still uses it."))
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete unit", "", ""),
		"Title":   "Delete unit “" + u.Name + "”?",
		"Body":    "This only removes the unit from the list. No products use it.",
		"Action":  "/admin/units/" + itoa(id) + "/delete",
		"Cancel":  "/admin/units",
		"Confirm": "Delete unit",
	})
}

func (s *Server) deleteUnit(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteUnit(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, store.ErrUnitInUse) {
		c.Redirect(http.StatusSeeOther, "/admin/units?error="+url.QueryEscape("Cannot delete a unit while a product still uses it."))
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete unit")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/units")
}
