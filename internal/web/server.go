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

	s.engine.GET("/", s.index)

	s.engine.GET("/admin", s.admin)
	s.engine.POST("/admin", s.updateAdmin)

	s.engine.GET("/receipts", s.receipts)
	s.engine.POST("/receipts", s.scanReceipt)
	s.engine.GET("/receipts/:id/preview", s.receiptPreview)
	s.engine.GET("/receipts/:id/edit", s.editReceipt)
	s.engine.POST("/receipts/:id/edit", s.updateReceiptVisit)
	s.engine.GET("/receipts/:id", s.showReceipt)
	s.engine.POST("/receipts/:id", s.confirmReceipt)

	s.engine.GET("/units", s.units)
	s.engine.POST("/units", s.createUnit)
	s.engine.GET("/units/:id/edit", s.editUnit)
	s.engine.POST("/units/:id", s.updateUnit)
	s.engine.GET("/units/:id/delete", s.confirmDeleteUnit)
	s.engine.POST("/units/:id/delete", s.deleteUnit)

	s.engine.GET("/companies", s.companies)
	s.engine.GET("/companies/new", s.newCompany)
	s.engine.POST("/companies", s.createCompany)
	s.engine.GET("/companies/:id/edit", s.editCompany)
	s.engine.POST("/companies/:id", s.updateCompany)
	s.engine.GET("/companies/:id/delete", s.confirmDeleteCompany)
	s.engine.POST("/companies/:id/delete", s.deleteCompany)

	s.engine.GET("/aliases", s.aliases)
	s.engine.GET("/aliases/new", s.newAlias)
	s.engine.POST("/aliases", s.createAlias)
	s.engine.GET("/aliases/:id/edit", s.editAlias)
	s.engine.POST("/aliases/:id", s.updateAlias)
	s.engine.GET("/aliases/:id/delete", s.confirmDeleteAlias)
	s.engine.POST("/aliases/:id/delete", s.deleteAlias)

	s.engine.GET("/products/new", s.newProduct)
	s.engine.POST("/products", s.createProduct)
	s.engine.GET("/products/:id", s.showProduct)
	s.engine.GET("/products/:id/edit", s.editProduct)
	s.engine.POST("/products/:id", s.updateProduct)
	s.engine.GET("/products/:id/change-unit", s.changeProductUnitForm)
	s.engine.POST("/products/:id/change-unit", s.changeProductUnit)
	s.engine.GET("/products/:id/merge-with", s.mergeProductForm)
	s.engine.POST("/products/:id/merge-with", s.mergeProductRedirect)
	s.engine.GET("/products/:id/merge-with/:into/", s.mergeProductConfirm)
	s.engine.POST("/products/:id/merge-with/:into/", s.mergeProduct)
	s.engine.GET("/products/:id/delete", s.confirmDeleteProduct)
	s.engine.POST("/products/:id/delete", s.deleteProduct)
	s.engine.GET("/products/:id/purchases/new", s.newPurchase)
	s.engine.POST("/products/:id/purchases", s.createPurchase)

	s.engine.GET("/purchases/:id/edit", s.editPurchase)
	s.engine.POST("/purchases/:id", s.updatePurchase)
	s.engine.GET("/purchases/:id/delete", s.confirmDeletePurchase)
	s.engine.POST("/purchases/:id/delete", s.deletePurchase)
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
	boughtOn = strings.TrimSpace(c.PostForm("bought_on"))
	if _, err := time.Parse("2006-01-02", boughtOn); err != nil {
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
	return boughtOn, decimal.Zero, amount, packages, packSize, ""
}

func purchaseSaveError(err error) string {
	switch {
	case errors.Is(err, store.ErrIncompletePackage), errors.Is(err, store.ErrInvalidPackage):
		return "Packages and package size must be greater than zero."
	default:
		return "Could not save the purchase."
	}
}
