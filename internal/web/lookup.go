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
}

type chartPoint struct {
	On    string `json:"on"`
	Price string `json:"price"`
}

func (s *Server) home(c *gin.Context) {
	c.HTML(http.StatusOK, "lookup.html", gin.H{
		"Page": s.page("Find a product", "", ""),
	})
}

func (s *Server) productSuggestions(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusOK, []suggestItem{})
		return
	}
	items, err := s.store.ListProducts(q)
	if err != nil {
		c.String(http.StatusInternalServerError, "could not search products")
		return
	}
	if len(items) > suggestLimit {
		items = items[:suggestLimit]
	}
	out := make([]suggestItem, 0, len(items))
	for _, it := range items {
		img := ""
		if it.ImagePath.Valid && strings.TrimSpace(it.ImagePath.String) != "" {
			img = "/images/" + it.ImagePath.String
		}
		out = append(out, suggestItem{
			ID:    it.ID,
			Name:  it.Name,
			Unit:  it.UnitName,
			Image: img,
		})
	}
	c.JSON(http.StatusOK, out)
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
	since30 := today.AddDate(0, 0, -30)
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
	c.HTML(http.StatusOK, "lookup_show.html", gin.H{
		"Page":      s.page(p.Name, "", ""),
		"Product":   p,
		"Last":      store.LastUnitPrice(purchases),
		"Low30":     store.LowestSince(purchases, since30),
		"ChartJSON": string(chartJSON),
		"HasChart":  len(points) > 0,
		"ChartFrom": from365.Format("2006-01-02"),
		"ChartTo":   today.Format("2006-01-02"),
	})
}
