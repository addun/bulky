package web

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

const suggestLimit = 10

type suggestItem struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Unit  string `json:"unit"`
	Image string `json:"image"`
	Price string `json:"price,omitempty"`
}

type chartPoint struct {
	On    string `json:"on"`
	Price string `json:"price"`
}

func (s *Server) home(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	items, err := s.loadSuggestions(q)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not search products")
		return
	}
	c.HTML(http.StatusOK, "lookup.html", gin.H{
		"Page":     s.page("Find a product", q, ""),
		"Query":    q,
		"Products": items,
	})
}

func (s *Server) productSuggestionsJSON(c *gin.Context) {
	items, err := s.loadSuggestions(c.Query("q"))
	if err != nil {
		c.String(http.StatusInternalServerError, "could not search products")
		return
	}
	c.JSON(http.StatusOK, s.toSuggestItems(items))
}

func (s *Server) productSuggestionsHTML(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	items, err := s.loadSuggestions(q)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not search products")
		return
	}
	c.HTML(http.StatusOK, "lookup_suggestions.html", gin.H{
		"Query":    q,
		"Products": items,
	})
}

func (s *Server) loadSuggestions(q string) ([]store.ProductQuote, error) {
	return s.store.SearchProductQuotes(strings.TrimSpace(q), time.Now(), suggestLimit)
}

func (s *Server) toSuggestItems(items []store.ProductQuote) []suggestItem {
	out := make([]suggestItem, 0, len(items))
	for _, it := range items {
		img := ""
		if it.Product.ImagePath.Valid && strings.TrimSpace(it.Product.ImagePath.String) != "" {
			img = "/images/" + it.Product.ImagePath.String
		}
		item := suggestItem{
			ID:    it.Product.ID,
			Name:  it.Product.Name,
			Unit:  it.Product.UnitName,
			Image: img,
		}
		if it.Quote != nil {
			item.Price = formatMoneyPerUnit(it.Quote.Price, s.cfg.CurrencySymbol, it.Product.UnitName)
		}
		out = append(out, item)
	}
	return out
}

func (s *Server) showLookup(c *gin.Context) {
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
		c.String(http.StatusInternalServerError, "could not load prices")
		return
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	from365 := today.AddDate(0, 0, -365)
	points := store.PricesBetween(purchases, from365, today)
	rows := make([]chartPoint, 0, len(points))
	for _, pt := range points {
		rows = append(rows, chartPoint{On: store.BoughtOnDate(pt.BoughtOn), Price: pt.Price.String()})
	}
	chartJSON, err := json.Marshal(rows)
	if err != nil {
		chartJSON = []byte("[]")
	}
	comparisons, err := s.store.RelatedGroupProducts(id, now)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not load related products")
		return
	}
	c.HTML(http.StatusOK, "lookup_show.html", gin.H{
		"Page":      s.page(p.Name, "", ""),
		"Product":   p,
		"Quote":     store.BestRecentPrice(purchases, now),
		"ChartJSON": string(chartJSON),
		"HasChart":  len(points) > 0,
		"ChartFrom": from365.Format("2006-01-02"),
		"ChartTo":   today.Format("2006-01-02"),
		"Related":   comparisons,
	})
}
