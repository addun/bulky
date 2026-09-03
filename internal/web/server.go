package web

import (
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

type Config struct {
	Currency       string
	CurrencySymbol string
	OCR            ocr.Config
}

type Server struct {
	store  *store.Store
	engine *gin.Engine
	tmpl   *template.Template
	cfg    Config
	reader *ocr.Agent
}

type page struct {
	Title    string
	Query    string
	Error    string
	Symbol   string
	Currency string
	Today    string
	Admin    bool
}

func New(st *store.Store, cfg Config) (*Server, error) {
	if cfg.Currency == "" {
		cfg.Currency = "PLN"
	}
	if cfg.CurrencySymbol == "" {
		cfg.CurrencySymbol = "zł"
	}
	sub, err := fs.Sub(assets, "templates")
	if err != nil {
		return nil, err
	}
	tmpl, err := template.New("").Funcs(templateFuncs(cfg.CurrencySymbol)).ParseFS(sub, "*.html")
	if err != nil {
		return nil, err
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.MaxMultipartMemory = 12 << 20
	r.SetHTMLTemplate(tmpl)

	s := &Server{store: st, engine: r, tmpl: tmpl, cfg: cfg, reader: ocr.New(cfg.OCR)}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return s.engine
}

func (s *Server) routes() {
	static, err := fs.Sub(assets, "static")
	if err != nil {
		log.Fatal(err)
	}
	s.engine.StaticFS("/static", http.FS(static))
	s.engine.Static("/images", s.store.ImagesDir())

	s.engine.GET("/", s.home)
	s.engine.GET("/api/products/suggestions", s.productSuggestions)
	s.engine.GET("/products/:id", s.showLookup)

	s.engine.GET("/admin", s.index)
	s.engine.GET("/admin/settings", s.admin)
	s.engine.POST("/admin/settings", s.updateAdmin)

	s.engine.GET("/admin/receipts", s.receipts)
	s.engine.POST("/admin/receipts", s.scanReceipt)
	s.engine.GET("/admin/receipts/:id/preview", s.receiptPreview)
	s.engine.GET("/admin/receipts/:id/edit", s.editReceipt)
	s.engine.POST("/admin/receipts/:id/edit", s.updateReceiptVisit)
	s.engine.GET("/admin/receipts/:id", s.showReceipt)
	s.engine.POST("/admin/receipts/:id", s.confirmReceipt)

	s.engine.GET("/admin/units", s.units)
	s.engine.POST("/admin/units", s.createUnit)
	s.engine.GET("/admin/units/:id/edit", s.editUnit)
	s.engine.POST("/admin/units/:id", s.updateUnit)
	s.engine.GET("/admin/units/:id/delete", s.confirmDeleteUnit)
	s.engine.POST("/admin/units/:id/delete", s.deleteUnit)

	s.engine.GET("/admin/companies", s.companies)
	s.engine.GET("/admin/companies/new", s.newCompany)
	s.engine.POST("/admin/companies", s.createCompany)
	s.engine.GET("/admin/companies/:id/edit", s.editCompany)
	s.engine.POST("/admin/companies/:id", s.updateCompany)
	s.engine.GET("/admin/companies/:id/delete", s.confirmDeleteCompany)
	s.engine.POST("/admin/companies/:id/delete", s.deleteCompany)

	s.engine.GET("/admin/aliases", s.aliases)
	s.engine.GET("/admin/aliases/new", s.newAlias)
	s.engine.POST("/admin/aliases", s.createAlias)
	s.engine.GET("/admin/aliases/:id/edit", s.editAlias)
	s.engine.POST("/admin/aliases/:id", s.updateAlias)
	s.engine.GET("/admin/aliases/:id/delete", s.confirmDeleteAlias)
	s.engine.POST("/admin/aliases/:id/delete", s.deleteAlias)

	s.engine.GET("/admin/products/new", s.newProduct)
	s.engine.POST("/admin/products", s.createProduct)
	s.engine.GET("/admin/products/:id", s.showProduct)
	s.engine.GET("/admin/products/:id/edit", s.editProduct)
	s.engine.POST("/admin/products/:id", s.updateProduct)
	s.engine.GET("/admin/products/:id/change-unit", s.changeProductUnitForm)
	s.engine.POST("/admin/products/:id/change-unit", s.changeProductUnit)
	s.engine.GET("/admin/products/:id/merge-with", s.mergeProductForm)
	s.engine.POST("/admin/products/:id/merge-with", s.mergeProductRedirect)
	s.engine.GET("/admin/products/:id/merge-with/:into/", s.mergeProductConfirm)
	s.engine.POST("/admin/products/:id/merge-with/:into/", s.mergeProduct)
	s.engine.GET("/admin/products/:id/delete", s.confirmDeleteProduct)
	s.engine.POST("/admin/products/:id/delete", s.deleteProduct)
	s.engine.GET("/admin/products/:id/purchases/new", s.newPurchase)
	s.engine.POST("/admin/products/:id/purchases", s.createPurchase)

	s.engine.GET("/admin/purchases/:id/edit", s.editPurchase)
	s.engine.POST("/admin/purchases/:id", s.updatePurchase)
	s.engine.GET("/admin/purchases/:id/delete", s.confirmDeletePurchase)
	s.engine.POST("/admin/purchases/:id/delete", s.deletePurchase)
}

func (s *Server) page(title, query, errMsg string) page {
	return page{
		Title:    title,
		Query:    query,
		Error:    errMsg,
		Symbol:   s.cfg.CurrencySymbol,
		Currency: s.cfg.Currency,
		Today:    time.Now().Format("2006-01-02"),
	}
}

func (s *Server) adminPage(title, query, errMsg string) page {
	p := s.page(title, query, errMsg)
	p.Admin = true
	return p
}

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}

func paramID(c *gin.Context, name string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func formInt64(c *gin.Context, name string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(c.PostForm(name)), 10, 64)
	return v
}

func formInt64Query(c *gin.Context, name string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(c.Query(name)), 10, 64)
	return v
}

func (s *Server) parsePurchase(c *gin.Context) (boughtOn string, qty, amount, packages, packSize decimal.Decimal, errMsg string) {
	when, whenErr := store.NormalizeBoughtOn(store.JoinBoughtOn(c.PostForm("bought_on"), c.PostForm("bought_at")))
	if whenErr != nil {
		return "", decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, "Date must be a valid day."
	}
	amount, err := parseDecimal(c.PostForm("amount"), 2, true)
	if err != nil {
		return "", decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, "Amount " + err.Error() + "."
	}
	packages, err = parseDecimal(c.PostForm("packages"), 8, false)
	if err != nil {
		return "", decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, "Packages " + err.Error() + "."
	}
	packSize, err = parseDecimal(c.PostForm("package_size"), 8, false)
	if err != nil {
		return "", decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero, "Package size " + err.Error() + "."
	}
	return when, decimal.Zero, amount, packages, packSize, ""
}

func purchaseSaveError(err error) string {
	switch {
	case errors.Is(err, store.ErrIncompletePackage), errors.Is(err, store.ErrInvalidPackage):
		return "Packages and package size must be greater than zero."
	default:
		return "Could not save the purchase."
	}
}
