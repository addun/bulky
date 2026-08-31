package web

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) index(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	items, err := s.store.ListProducts(q)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load products")
		return
	}
	errMsg := c.Query("error")
	imported, _ := strconv.Atoi(c.Query("imported"))
	c.HTML(http.StatusOK, "index.html", gin.H{
		"Page":     s.page("Products", q, errMsg),
		"Products": items,
		"Imported": imported,
	})
}

func (s *Server) newProduct(c *gin.Context) {
	units, err := s.store.ListUnits()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load units")
		return
	}
	c.HTML(http.StatusOK, "product_form.html", gin.H{
		"Page":    s.page("Add product", "", ""),
		"Units":   units,
		"Product": store.Product{},
		"New":     true,
	})
}

func (s *Server) editProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	units, err := s.store.ListUnits()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load units")
		return
	}
	c.HTML(http.StatusOK, "product_form.html", gin.H{
		"Page":    s.page("Edit "+p.Name, "", ""),
		"Units":   units,
		"Product": p,
		"New":     false,
	})
}

func (s *Server) createProduct(c *gin.Context) {
	s.saveProduct(c, 0)
}

func (s *Server) updateProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	s.saveProduct(c, id)
}

func (s *Server) saveProduct(c *gin.Context, id int64) {
	name := strings.TrimSpace(c.PostForm("name"))
	units, _ := s.store.ListUnits()
	renderErr := func(msg string, p store.Product) {
		c.HTML(http.StatusUnprocessableEntity, "product_form.html", gin.H{
			"Page":    s.page(ifThen(id == 0, "Add product", "Edit product"), "", msg),
			"Units":   units,
			"Product": p,
			"New":     id == 0,
		})
	}
	if name == "" {
		renderErr("Name is required.", store.Product{ID: id, Name: name, UnitID: formInt64(c, "unit_id")})
		return
	}
	unitID := formInt64(c, "unit_id")
	if _, err := s.store.GetUnit(unitID); err != nil {
		renderErr("Choose a unit.", store.Product{ID: id, Name: name, UnitID: unitID})
		return
	}

	var imgName string
	if fh, ferr := c.FormFile("image"); ferr == nil {
		var err error
		imgName, err = s.saveImage(fh)
		if err != nil {
			renderErr(err.Error()+".", store.Product{ID: id, Name: name, UnitID: unitID})
			return
		}
	}

	clearImage := c.PostForm("clear_image") == "1"
	if id == 0 {
		var path *string
		if imgName != "" {
			path = &imgName
		}
		p, err := s.store.CreateProduct(name, unitID, path)
		if err != nil {
			s.deleteImage(imgName)
			if errors.Is(err, store.ErrDuplicate) {
				renderErr("That name is already used as an alias.", store.Product{Name: name, UnitID: unitID})
				return
			}
			renderErr("Could not save the product.", store.Product{Name: name, UnitID: unitID})
			return
		}
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(p.ID))
		return
	}

	cur, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		s.deleteImage(imgName)
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		s.deleteImage(imgName)
		renderErr("Could not save the product.", cur)
		return
	}

	var newPath *string
	if imgName != "" {
		newPath = &imgName
	}
	if err := s.store.UpdateProduct(id, name, unitID, newPath, clearImage && imgName == ""); err != nil {
		s.deleteImage(imgName)
		if errors.Is(err, store.ErrDuplicate) {
			renderErr("That name is already used as an alias.", cur)
			return
		}
		renderErr("Could not save the product.", cur)
		return
	}
	if imgName != "" && cur.ImagePath.Valid {
		s.deleteImage(cur.ImagePath.String)
	}
	if clearImage && imgName == "" && cur.ImagePath.Valid {
		s.deleteImage(cur.ImagePath.String)
	}
	c.Redirect(http.StatusSeeOther, "/products/"+itoa(id))
}

func (s *Server) showProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	purchases, err := s.store.ListPurchases(id)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchases")
		return
	}
	companies, err := s.store.ListCompanies()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load companies")
		return
	}
	errMsg := c.Query("error")
	c.HTML(http.StatusOK, "product_show.html", gin.H{
		"Page":        s.page(p.Name, "", errMsg),
		"Product":     p,
		"Purchases":   purchases,
		"CompanyByID": companiesByID(companies),
		"Years":       store.YearlySummaries(purchases),
	})
}

func (s *Server) mergeProductForm(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	s.renderMergeForm(c, http.StatusOK, p, formInt64Query(c, "into_id"), "")
}

func (s *Server) mergeProductRedirect(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	intoID := formInt64(c, "into_id")
	if intoID <= 0 {
		p, err := s.store.GetProduct(id)
		if errors.Is(err, store.ErrNotFound) {
			c.String(http.StatusNotFound, "not found")
			return
		}
		if err != nil {
			c.String(http.StatusInternalServerError, "could not load product")
			return
		}
		s.renderMergeForm(c, http.StatusUnprocessableEntity, p, 0, "Choose a product.")
		return
	}
	c.Redirect(http.StatusSeeOther, mergeWithPath(id, intoID))
}

func (s *Server) mergeProductConfirm(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	intoID, ok := paramID(c, "into")
	if !ok {
		s.renderMergeForm(c, http.StatusUnprocessableEntity, p, 0, "Choose a product.")
		return
	}
	plan, err := s.store.MergePlan(intoID, id)
	if err != nil {
		msg := mergeFormError(err)
		if msg == "" {
			c.String(http.StatusInternalServerError, "could not load merge")
			return
		}
		s.renderMergeForm(c, http.StatusUnprocessableEntity, p, intoID, msg)
		return
	}
	c.HTML(http.StatusOK, "product_merge_confirm.html", gin.H{
		"Page": s.page("Merge "+plan.From.Name, "", ""),
		"Plan": plan,
	})
}

func (s *Server) mergeProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	intoID, ok := paramID(c, "into")
	if !ok {
		s.renderMergeForm(c, http.StatusUnprocessableEntity, p, 0, "Choose a product.")
		return
	}
	keeper, img, err := s.store.MergeProducts(intoID, id)
	if err == nil {
		s.deleteImage(img)
		c.Redirect(http.StatusSeeOther, "/products/"+itoa(keeper.ID))
		return
	}
	msg := mergeFormError(err)
	if msg == "" {
		c.String(http.StatusInternalServerError, "could not merge")
		return
	}
	s.renderMergeForm(c, http.StatusUnprocessableEntity, p, intoID, msg)
}

func mergeWithPath(fromID, intoID int64) string {
	return "/products/" + itoa(fromID) + "/merge-with/" + itoa(intoID) + "/"
}

func mergeFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrSameProduct):
		return "Choose a different product."
	case errors.Is(err, store.ErrNotFound):
		return "Choose a product."
	case errors.Is(err, store.ErrUnitMismatch):
		return "Those products use different units."
	default:
		return ""
	}
}

func (s *Server) renderMergeForm(c *gin.Context, status int, p store.Product, intoID int64, errMsg string) {
	items, err := s.store.ListProducts("")
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load products")
		return
	}
	targets := make([]store.ProductListItem, 0, len(items))
	for _, it := range items {
		if it.ID == p.ID {
			continue
		}
		targets = append(targets, it)
	}
	c.HTML(status, "product_merge.html", gin.H{
		"Page":    s.page("Merge "+p.Name, "", errMsg),
		"Product": p,
		"Targets": targets,
		"IntoID":  intoID,
	})
}

func (s *Server) confirmDeleteProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	p, err := s.store.GetProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load product")
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.page("Delete "+p.Name, "", ""),
		"Title":   "Delete " + p.Name + "?",
		"Body":    "This removes the product and every purchase and price recorded for it. The unit stays.",
		"Action":  "/products/" + itoa(id) + "/delete",
		"Cancel":  "/products/" + itoa(id),
		"Confirm": "Delete product",
	})
}

func (s *Server) deleteProduct(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	img, err := s.store.DeleteProduct(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete")
		return
	}
	s.deleteImage(img)
	c.Redirect(http.StatusSeeOther, "/")
}

func ifThen[T any](cond bool, a, b T) T {
	if cond {
		return a
	}
	return b
}
