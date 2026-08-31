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
	err := s.store.SetSetting(store.SettingOCRModel, model)
	if errors.Is(err, store.ErrInvalidSetting) {
		s.renderAdmin(c, http.StatusUnprocessableEntity, "AI model is required.")
		return
	}
	if err != nil {
		s.renderAdmin(c, http.StatusInternalServerError, "Could not save settings.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin")
}

func (s *Server) renderAdmin(c *gin.Context, status int, errMsg string) {
	model, err := s.ocrModel()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load settings")
		return
	}
	c.HTML(status, "admin.html", gin.H{
		"Page":     s.page("Admin", "", errMsg),
		"OCRModel": model,
	})
}
