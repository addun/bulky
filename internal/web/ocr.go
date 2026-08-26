package web

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) ocrPage(c *gin.Context) {
	c.HTML(http.StatusOK, "ocr.html", gin.H{
		"Page":       s.page("Scan bill", "", c.Query("error")),
		"Configured": s.ocr.Configured(),
		"Model":      s.ocrModel(),
	})
}

func (s *Server) ocrScan(c *gin.Context) {
	if !s.ocr.Configured() {
		c.Redirect(http.StatusSeeOther, "/ocr?error="+url.QueryEscape("Set OCR_API_KEY or OCR_BASE_URL so the reader can run."))
		return
	}
	fh, err := pickFormFile(c, "bill", "bill_camera")
	if err != nil {
		s.renderOCR(c, http.StatusUnprocessableEntity, "Choose a photo of the bill.")
		return
	}
	if fh.Size > ocr.MaxImageBytes {
		s.renderOCR(c, http.StatusUnprocessableEntity, "Image must be 10 MB or smaller.")
		return
	}
	f, err := fh.Open()
	if err != nil {
		s.renderOCR(c, http.StatusUnprocessableEntity, "Could not read the photo.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(f, ocr.MaxImageBytes+1))
	f.Close()
	if err != nil {
		s.renderOCR(c, http.StatusUnprocessableEntity, "Could not read the photo.")
		return
	}
	if int64(len(raw)) > ocr.MaxImageBytes {
		s.renderOCR(c, http.StatusUnprocessableEntity, "Image must be 10 MB or smaller.")
		return
	}

	jpeg, err := ocr.PrepareJPEG(raw)
	if err != nil {
		s.renderOCR(c, http.StatusUnprocessableEntity, strings.TrimSuffix(err.Error(), ".")+".")
		return
	}
	imagePath, err := s.saveOCRPreview(jpeg)
	if err != nil {
		s.renderOCR(c, http.StatusInternalServerError, "Could not store the photo.")
		return
	}

	recipe, err := s.store.CreateRecipe(imagePath)
	if err != nil {
		s.deleteOCRPreview(imagePath)
		s.renderOCR(c, http.StatusInternalServerError, "Could not save the recipe.")
		return
	}

	catalog, _, _, err := s.ocrCatalog()
	if err != nil {
		_ = s.store.FailRecipe(recipe.ID)
		s.renderOCR(c, http.StatusInternalServerError, "Could not load the catalog.")
		return
	}

	_, rawJSON, err := s.ocr.Extract(jpeg, catalog)
	if err != nil {
		_ = s.store.FailRecipe(recipe.ID)
		msg := "Could not read the bill: " + err.Error()
		if errors.Is(err, ocr.ErrNotABill) {
			msg = "That photo does not look like a bill. Try a clearer shot of the whole receipt."
		} else if errors.Is(err, ocr.ErrNoLines) {
			msg = "No products could be read from this bill. Try another photo."
		}
		status := http.StatusBadGateway
		if errors.Is(err, ocr.ErrNotABill) || errors.Is(err, ocr.ErrNoLines) {
			status = http.StatusUnprocessableEntity
		}
		s.renderOCR(c, status, msg)
		return
	}

	if err := s.store.SaveAIResponse(recipe.ID, string(rawJSON)); err != nil {
		_ = s.store.FailRecipe(recipe.ID)
		s.renderOCR(c, http.StatusInternalServerError, "Could not save the AI response.")
		return
	}
	c.Redirect(http.StatusSeeOther, "/ocr/"+itoa(recipe.ID))
}

func (s *Server) ocrReview(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	recipe, err := s.store.GetRecipe(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the recipe")
		return
	}
	if recipe.Status == store.RecipeFailed || recipe.Status == store.RecipePending {
		s.renderOCR(c, http.StatusUnprocessableEntity, "This scan has no product list yet. Upload the bill again.")
		return
	}
	products, units, companies, err := s.ocrLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}
	view, err := recipeToView(recipe, products, units, companies)
	if err != nil {
		s.renderOCR(c, http.StatusInternalServerError, "Could not read the saved AI response.")
		return
	}
	s.renderOCRReview(c, http.StatusOK, view, products, units, companies, c.Query("error"))
}

func (s *Server) ocrConfirm(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	recipe, err := s.store.GetRecipe(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the recipe")
		return
	}

	products, units, companies, err := s.ocrLookups()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load the catalog")
		return
	}

	in, view, msg := parseOCRForm(c.PostForm)
	view.RecipeID = id
	view.ImagePath = recipe.ImagePath
	view.Status = recipe.Status
	view.CompanyID = knownCompanyID(view.CompanyID, companies)
	in.CompanyID = view.CompanyID
	rawJSON, jsonErr := viewToRawJSON(view)
	if jsonErr == nil {
		_ = s.store.UpdateRecipeJSON(id, string(rawJSON))
	}
	if recipe.Status == store.RecipeMigrated {
		s.renderOCRReview(c, http.StatusConflict, view, products, units, companies, "This bill is already saved as purchases.")
		return
	}
	if view.CompanyID == 0 && formInt(c.PostForm("company_id")) > 0 {
		s.renderOCRReview(c, http.StatusUnprocessableEntity, view, products, units, companies, "Choose a company.")
		return
	}
	if msg != "" {
		s.renderOCRReview(c, http.StatusUnprocessableEntity, view, products, units, companies, msg)
		return
	}
	if jsonErr != nil {
		s.renderOCRReview(c, http.StatusInternalServerError, view, products, units, companies, "Could not save the product list.")
		return
	}
	res, err := s.store.MigrateRecipe(id, in, string(rawJSON))
	if err != nil {
		msg := "Could not save the purchases."
		if errors.Is(err, store.ErrRecipeMigrated) {
			msg = "This bill is already saved as purchases."
		} else if errors.Is(err, store.ErrRecipeNotReady) {
			msg = "This scan has no product list yet."
		} else if errors.Is(err, store.ErrInvalidUnit) {
			msg = "Choose a unit for each new product."
		} else if errors.Is(err, store.ErrNotFound) {
			msg = "A selected product is gone. Refresh and try again."
		} else if errors.Is(err, store.ErrInvalidCompany) {
			msg = "Choose a company."
		} else if err.Error() == "product name is required" || err.Error() == "name is required" {
			msg = "Name is required for each new product."
		} else if err.Error() == "no products to import" {
			msg = "Tick at least one product."
		}
		s.renderOCRReview(c, http.StatusUnprocessableEntity, view, products, units, companies, msg)
		return
	}
	c.Redirect(http.StatusSeeOther, "/?imported="+itoa(int64(res.Purchases)))
}

func (s *Server) ocrPreview(c *gin.Context) {
	path, ok := s.ocrPreviewPath(c.Param("id"))
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.File(path)
}

func (s *Server) renderOCR(c *gin.Context, status int, errMsg string) {
	c.HTML(status, "ocr.html", gin.H{
		"Page":       s.page("Scan bill", "", errMsg),
		"Configured": s.ocr.Configured(),
		"Model":      s.ocrModel(),
	})
}

func (s *Server) renderOCRReview(c *gin.Context, status int, view ocrView, products []store.ProductListItem, units []store.Unit, companies []store.Company, errMsg string) {
	c.HTML(status, "ocr_review.html", gin.H{
		"Page":      s.page("Confirm bill", "", errMsg),
		"View":      view,
		"Products":  products,
		"Units":     units,
		"Companies": companies,
	})
}

func (s *Server) ocrLookups() ([]store.ProductListItem, []store.Unit, []store.Company, error) {
	products, err := s.store.ListProducts("")
	if err != nil {
		return nil, nil, nil, err
	}
	units, err := s.store.ListUnits()
	if err != nil {
		return nil, nil, nil, err
	}
	companies, err := s.store.ListCompanies()
	if err != nil {
		return nil, nil, nil, err
	}
	return products, units, companies, nil
}

func (s *Server) ocrCatalog() (ocr.Catalog, []store.ProductListItem, []store.Unit, error) {
	products, units, _, err := s.ocrLookups()
	if err != nil {
		return ocr.Catalog{}, nil, nil, err
	}
	cat := ocr.Catalog{
		Products: make([]ocr.CatalogProduct, 0, len(products)),
		Units:    make([]ocr.CatalogUnit, 0, len(units)),
	}
	for _, p := range products {
		cat.Products = append(cat.Products, ocr.CatalogProduct{
			ID: p.ID, Name: p.Name, UnitID: p.UnitID, UnitName: p.UnitName,
		})
	}
	for _, u := range units {
		cat.Units = append(cat.Units, ocr.CatalogUnit{ID: u.ID, Name: u.Name})
	}
	return cat, products, units, nil
}

func (s *Server) ocrModel() string {
	if s.cfg.OCR.Model != "" {
		return s.cfg.OCR.Model
	}
	return ocr.DefaultModel
}

func pickFormFile(c *gin.Context, names ...string) (*multipart.FileHeader, error) {
	var lastErr error
	for _, name := range names {
		fh, err := c.FormFile(name)
		if err != nil {
			lastErr = err
			continue
		}
		if fh != nil && (fh.Filename != "" || fh.Size > 0) {
			return fh, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, http.ErrMissingFile
}
