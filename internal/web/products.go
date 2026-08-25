package web

import (
	"errors"
	"net/http"
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
	c.HTML(http.StatusOK, "index.html", gin.H{
		"Page":     s.page("Products", q, ""),
		"Products": items,
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
		"Companies":   companies,
		"CompanyByID": companiesByID(companies),
		"Years":       store.YearlySummaries(purchases),
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
		"Body":    "This removes the product and every purchase recorded for it. The unit stays.",
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
