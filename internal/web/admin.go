package web

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) admin(c *gin.Context) {
	s.renderAdmin(c, http.StatusOK, "")
}

func (s *Server) updateAdmin(c *gin.Context) {
	model := strings.TrimSpace(c.PostForm("ocr_model"))
	if model == "" {
		s.renderAdmin(c, http.StatusUnprocessableEntity, "AI model is required.")
		return
	}
	defaults := store.UnitDefaults{
		PieceID:  formInt64(c, "piece_unit_id"),
		WeightID: formInt64(c, "weight_unit_id"),
	}
	if err := s.store.SetUnitDefaults(defaults); err != nil {
		if errors.Is(err, store.ErrInvalidUnit) {
			s.renderAdmin(c, http.StatusUnprocessableEntity, "Choose a unit from the list.")
			return
		}
		s.renderAdmin(c, http.StatusInternalServerError, "Could not save settings.")
		return
	}
	if err := s.store.SetSetting(store.SettingOCRModel, model); err != nil {
		s.renderAdmin(c, http.StatusInternalServerError, "Could not save settings.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/settings")
}

func (s *Server) renderAdmin(c *gin.Context, status int, errMsg string) {
	model, err := s.ocrModel()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load settings")
		return
	}
	units, err := s.store.ListUnits()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load units")
		return
	}
	defaults, err := s.store.UnitDefaults()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load settings")
		return
	}
	c.HTML(status, "admin.html", gin.H{
		"Page":     s.adminPage("Settings", "", errMsg),
		"OCRModel": model,
		"Units":    units,
		"Defaults": defaults,
	})
}
