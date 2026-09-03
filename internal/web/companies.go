package web

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

func (s *Server) companies(c *gin.Context) {
	list, err := s.store.ListCompanies()
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load companies")
		return
	}
	c.HTML(http.StatusOK, "companies.html", gin.H{
		"Page":      s.adminPage("Companies", "", c.Query("error")),
		"Companies": list,
	})
}

func (s *Server) newCompany(c *gin.Context) {
	s.renderCompanyForm(c, http.StatusOK, companyFromQuery(c), true, "", receiptReturnPath(c.Query("next")))
}

func (s *Server) createCompany(c *gin.Context) {
	name, street, building, apartment, postal, city := companyFields(c)
	form := store.Company{Name: name, StreetName: street, BuildingNumber: building, ApartmentNumber: apartment, PostalCode: postal, City: city}
	next := receiptReturnPath(c.PostForm("next"))
	_, err := s.store.CreateCompany(name, street, building, apartment, postal, city)
	if msg := companyFormError(err); msg != "" {
		s.renderCompanyForm(c, http.StatusUnprocessableEntity, form, true, msg, next)
		return
	}
	if err != nil {
		s.renderCompanyForm(c, http.StatusUnprocessableEntity, form, true, "Could not save the company.", next)
		return
	}
	if next != "" {
		c.Redirect(http.StatusSeeOther, next)
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/companies")
}

func (s *Server) editCompany(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	co, err := s.store.GetCompany(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load company")
		return
	}
	c.HTML(http.StatusOK, "company_form.html", gin.H{
		"Page":    s.adminPage("Edit company", "", ""),
		"Company": co,
		"New":     false,
	})
}

func (s *Server) updateCompany(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	name, street, building, apartment, postal, city := companyFields(c)
	err := s.store.UpdateCompany(id, name, street, building, apartment, postal, city)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	form := store.Company{ID: id, Name: name, StreetName: street, BuildingNumber: building, ApartmentNumber: apartment, PostalCode: postal, City: city}
	if msg := companyFormError(err); msg != "" {
		c.HTML(http.StatusUnprocessableEntity, "company_form.html", gin.H{
			"Page":    s.adminPage("Edit company", "", msg),
			"Company": form,
			"New":     false,
		})
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not save company")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/companies")
}

func (s *Server) confirmDeleteCompany(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	co, err := s.store.GetCompany(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load company")
		return
	}
	if co.PurchaseCount > 0 {
		c.Redirect(http.StatusSeeOther, "/admin/companies?error="+url.QueryEscape("Cannot delete “"+co.Name+"” while a purchase still uses it."))
		return
	}
	c.HTML(http.StatusOK, "confirm.html", gin.H{
		"Page":    s.adminPage("Delete company", "", ""),
		"Title":   "Delete company “" + co.Name + "”?",
		"Body":    "This only removes the company from the list. No purchases use it.",
		"Action":  "/admin/companies/" + itoa(id) + "/delete",
		"Cancel":  "/admin/companies",
		"Confirm": "Delete company",
	})
}

func (s *Server) deleteCompany(c *gin.Context) {
	id, ok := paramID(c, "id")
	if !ok {
		c.String(http.StatusNotFound, "not found")
		return
	}
	err := s.store.DeleteCompany(id)
	if errors.Is(err, store.ErrNotFound) {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if errors.Is(err, store.ErrCompanyInUse) {
		c.Redirect(http.StatusSeeOther, "/admin/companies?error="+url.QueryEscape("Cannot delete a company while a purchase still uses it."))
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "could not delete company")
		return
	}
	c.Redirect(http.StatusSeeOther, "/admin/companies")
}

func (s *Server) resolveCompanyForm(c *gin.Context) (int64, string) {
	id := formInt64(c, "company_id")
	if id <= 0 {
		return 0, ""
	}
	if _, err := s.store.GetCompany(id); errors.Is(err, store.ErrNotFound) {
		return 0, "Choose a company."
	} else if err != nil {
		return 0, "Could not load the company."
	}
	return id, ""
}

func companyFields(c *gin.Context) (name, street, building, apartment, postal, city string) {
	return strings.TrimSpace(c.PostForm("name")),
		strings.TrimSpace(c.PostForm("street_name")),
		strings.TrimSpace(c.PostForm("building_number")),
		strings.TrimSpace(c.PostForm("apartment_number")),
		strings.TrimSpace(c.PostForm("postal_code")),
		strings.TrimSpace(c.PostForm("city"))
}

func companyFromQuery(c *gin.Context) store.Company {
	q := func(field string) string {
		return strings.TrimSpace(c.Query(prefillQuery(field)))
	}
	return store.Company{
		Name:            q("name"),
		StreetName:      q("street_name"),
		BuildingNumber:  q("building_number"),
		ApartmentNumber: q("apartment_number"),
		PostalCode:      q("postal_code"),
		City:            q("city"),
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

func companyFormError(err error) string {
	switch {
	case errors.Is(err, store.ErrCompanyName):
		return "Name is required."
	case errors.Is(err, store.ErrCompanyStreet):
		return "Street name is required."
	case errors.Is(err, store.ErrCompanyBuilding):
		return "Building number is required."
	case errors.Is(err, store.ErrCompanyPostal):
		return "Postal code is required."
	case errors.Is(err, store.ErrCompanyCity):
		return "City is required."
	case errors.Is(err, store.ErrInvalidCompany):
		return "Choose a company."
	default:
		return ""
	}
}

func companiesByID(list []store.Company) map[int64]store.Company {
	m := make(map[int64]store.Company, len(list))
	for _, c := range list {
		m[c.ID] = c
	}
	return m
}

func (s *Server) renderCompanyForm(c *gin.Context, status int, co store.Company, isNew bool, errMsg, next string) {
	title := "Edit company"
	if isNew {
		title = "Add company"
	}
	c.HTML(status, "company_form.html", gin.H{
		"Page":    s.adminPage(title, "", errMsg),
		"Company": co,
		"New":     isNew,
		"Next":    next,
	})
}
