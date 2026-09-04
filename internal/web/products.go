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
		"Page":     s.adminPage("Products", q, errMsg),
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
		"Page":    s.adminPage("Add product", "", ""),
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
		"Page":    s.adminPage("Edit "+p.Name, "", ""),
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
			"Page":    s.adminPage(ifThen(id == 0, "Add product", "Edit product"), "", msg),
			"Units":   units,
			"Product": p,
			"New":     id == 0,
		})
	}
	if name == "" {
		p := store.Product{ID: id, Name: name, UnitID: formInt64(c, "unit_id")}
		p.Conversions, _ = parseExtraUnits(c, p.UnitID)
		renderErr("Name is required.", p)
		return
	}
	unitID := formInt64(c, "unit_id")
	if _, err := s.store.GetUnit(unitID); err != nil {
		p := store.Product{ID: id, Name: name, UnitID: unitID}
		p.Conversions, _ = parseExtraUnits(c, unitID)
		renderErr("Choose a unit.", p)
		return
	}
	convs, msg := parseExtraUnits(c, unitID)
	draft := store.Product{ID: id, Name: name, UnitID: unitID, Conversions: convs}
	if u, err := s.store.GetUnit(unitID); err == nil {
		draft.UnitName = u.Name
	}
	if msg != "" {
		renderErr(msg, draft)
		return
	}

	var imgName string
	if fh, ferr := c.FormFile("image"); ferr == nil {
		var err error
		imgName, err = s.saveImage(fh)
		if err != nil {
			renderErr(err.Error()+".", draft)
			return
		}
	}

	clearImage := c.PostForm("clear_image") == "1"
	if id == 0 {
		var path *string
		if imgName != "" {
			path = &imgName
		}
		p, err := s.store.CreateProduct(name, unitID, path, convs)
		if err != nil {
			s.deleteImage(imgName)
			if errors.Is(err, store.ErrDuplicate) {
				renderErr("That name is already used as an alias.", draft)
				return
			}
			if errors.Is(err, store.ErrInvalidConversion) {
				renderErr("Check the extra units: each must be different from the purchase unit, unique, and have a factor greater than zero.", draft)
				return
			}
			renderErr("Could not save the product.", draft)
			return
		}
		c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(p.ID))
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
		renderErr("Could not save the product.", draft)
		return
	}

	var newPath *string
	if imgName != "" {
		newPath = &imgName
	}
	if err := s.store.UpdateProduct(id, name, cur.UnitID, newPath, clearImage && imgName == "", convs); err != nil {
		s.deleteImage(imgName)
		if errors.Is(err, store.ErrDuplicate) {
			renderErr("That name is already used as an alias.", draft)
			return
		}
		if errors.Is(err, store.ErrInvalidConversion) {
			renderErr("Check the extra units: each must be different from the purchase unit, unique, and have a factor greater than zero.", draft)
			return
		}
		renderErr("Could not save the product.", draft)
		return
	}
	if imgName != "" && cur.ImagePath.Valid {
		s.deleteImage(cur.ImagePath.String)
	}
	if clearImage && imgName == "" && cur.ImagePath.Valid {
		s.deleteImage(cur.ImagePath.String)
	}
	c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(id))
}

func parseExtraUnits(c *gin.Context, purchaseUnitID int64) ([]store.ProductConversion, string) {
	ids := c.PostFormArray("extra_unit_id")
	factors := c.PostFormArray("extra_factor")
	n := len(ids)
	if len(factors) > n {
		n = len(factors)
	}
	var out []store.ProductConversion
	seen := map[int64]bool{}
	for i := 0; i < n; i++ {
		idStr, facStr := "", ""
		if i < len(ids) {
			idStr = strings.TrimSpace(ids[i])
		}
		if i < len(factors) {
			facStr = strings.TrimSpace(factors[i])
		}
		if idStr == "" && facStr == "" {
			continue
		}
		if idStr == "" {
			return out, "Choose a unit for each extra unit."
		}
		unitID, _ := strconv.ParseInt(idStr, 10, 64)
		if unitID == purchaseUnitID {
			return out, "An extra unit cannot be the same as the purchase unit."
		}
		if seen[unitID] {
			return out, "Each extra unit can only be listed once."
		}
		seen[unitID] = true
		factor, err := parseDecimal(facStr, 8, false)
		if err != nil {
			return out, "Extra unit factor " + err.Error() + "."
		}
		out = append(out, store.ProductConversion{UnitID: unitID, Factor: factor})
	}
	return out, ""
}

func (s *Server) changeProductUnitForm(c *gin.Context) {
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
	s.renderChangeUnit(c, http.StatusOK, p, 0, "")
}

func (s *Server) changeProductUnit(c *gin.Context) {
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
	unitID := formInt64(c, "unit_id")
	if _, ok := p.ConversionFor(unitID); !ok {
		s.renderChangeUnit(c, http.StatusUnprocessableEntity, p, unitID, "Choose one of the extra units on this product.")
		return
	}
	if err := s.store.ChangePurchaseUnit(id, unitID); err != nil {
		msg := "Could not change the unit."
		switch {
		case errors.Is(err, store.ErrInvalidUnit):
			msg = "Choose a different unit from the current purchase unit."
		case errors.Is(err, store.ErrInvalidConversion):
			msg = "Choose one of the extra units on this product."
		}
		s.renderChangeUnit(c, http.StatusUnprocessableEntity, p, unitID, msg)
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(id))
}

func (s *Server) renderChangeUnit(c *gin.Context, status int, p store.Product, newUnitID int64, errMsg string) {
	buys, err := s.store.ListPurchases(p.ID)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load purchases")
		return
	}
	c.HTML(status, "product_change_unit.html", gin.H{
		"Page":      s.adminPage("Change unit for "+p.Name, "", errMsg),
		"Product":   p,
		"NewUnitID": newUnitID,
		"History":   len(buys),
	})
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
	stories, err := s.store.ListStories()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load stores")
		return
	}
	errMsg := c.Query("error")
	c.HTML(http.StatusOK, "product_show.html", gin.H{
		"Page":      s.adminPage(p.Name, "", errMsg),
		"Product":   p,
		"Purchases": purchases,
		"StoryByID": storiesByID(stories),
		"Years":     store.YearlySummaries(purchases),
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
		"Page": s.adminPage("Merge "+plan.From.Name, "", ""),
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
		c.Redirect(http.StatusSeeOther, "/admin/products/"+itoa(keeper.ID))
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
	return "/admin/products/" + itoa(fromID) + "/merge-with/" + itoa(intoID) + "/"
}

func mergeFormError(err error) string {
	var conflict *store.ConversionConflictError
	switch {
	case errors.As(err, &conflict):
		return "Those products convert to " + conflict.UnitName + " differently."
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
		"Page":    s.adminPage("Merge "+p.Name, "", errMsg),
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
		"Page":    s.adminPage("Delete "+p.Name, "", ""),
		"Title":   "Delete " + p.Name + "?",
		"Body":    "This removes the product and every purchase and price recorded for it. The unit stays.",
		"Action":  "/admin/products/" + itoa(id) + "/delete",
		"Cancel":  "/admin/products/" + itoa(id),
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
	c.Redirect(http.StatusSeeOther, "/admin")
}

func ifThen[T any](cond bool, a, b T) T {
	if cond {
		return a
	}
	return b
}
