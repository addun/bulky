package web

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

type ocrView struct {
	RecipeID  int64
	ImagePath string
	Status    string
	BoughtOn  string
	Notes     string
	CompanyID int64
	Lines     []ocrLineView
}

func (v ocrView) Migrated() bool {
	return v.Status == store.RecipeMigrated
}

type ocrLineView struct {
	Include     bool
	ProductID   int64
	ProductName string
	UnitID      int64
	Quantity    string
	Amount      string
	ReceiptName string
}

func hydrateBill(bill ocr.Bill, products []store.ProductListItem, units []store.Unit) ocr.Bill {
	productByID := map[int64]store.ProductListItem{}
	productByName := map[string]store.ProductListItem{}
	for _, p := range products {
		productByID[p.ID] = p
		key := strings.ToLower(p.Name)
		if _, ok := productByName[key]; !ok {
			productByName[key] = p
		}
	}
	unitByID := map[int64]store.Unit{}
	unitByName := map[string]store.Unit{}
	for _, u := range units {
		unitByID[u.ID] = u
		unitByName[unitKey(u.Name)] = u
	}

	for i, line := range bill.Lines {
		if line.ProductID != 0 {
			if p, ok := productByID[line.ProductID]; ok {
				line.ProductID = p.ID
				line.UnitID = p.UnitID
				if line.ProductName == "" {
					line.ProductName = p.Name
				}
			} else {
				line.ProductID = 0
			}
		}
		if line.ProductID == 0 {
			if p, ok := productByName[strings.ToLower(line.ProductName)]; ok {
				line.ProductID = p.ID
				line.UnitID = p.UnitID
			} else if p, ok := productByName[strings.ToLower(line.ReceiptName)]; ok {
				line.ProductID = p.ID
				line.UnitID = p.UnitID
			}
		}
		if line.ProductID == 0 {
			if _, ok := unitByID[line.UnitID]; !ok {
				line.UnitID = 0
				if u, ok := unitByName[unitKey(line.UnitName)]; ok {
					line.UnitID = u.ID
				}
			}
		}
		bill.Lines[i] = line
	}
	return bill
}

func billToView(bill ocr.Bill, recipeID int64, imagePath, status string) ocrView {
	view := ocrView{
		RecipeID:  recipeID,
		ImagePath: imagePath,
		Status:    status,
		BoughtOn:  bill.BoughtOn,
		Notes:     bill.Notes,
		CompanyID: bill.CompanyID,
	}
	for _, line := range bill.ProductLines() {
		name := line.ProductName
		if name == "" {
			name = line.ReceiptName
		}
		view.Lines = append(view.Lines, ocrLineView{
			Include:     true,
			ProductID:   line.ProductID,
			ProductName: name,
			UnitID:      line.UnitID,
			Quantity:    line.Quantity,
			Amount:      line.Amount,
			ReceiptName: line.ReceiptName,
		})
	}
	return view
}

func recipeToView(r store.Recipe, products []store.ProductListItem, units []store.Unit, companies []store.Company) (ocrView, error) {
	var bill ocr.Bill
	if strings.TrimSpace(r.RawResponse) != "" {
		if err := json.Unmarshal([]byte(r.RawResponse), &bill); err != nil {
			return ocrView{}, err
		}
		bill = hydrateBill(bill, products, units)
	}
	view := billToView(bill, r.ID, r.ImagePath, r.Status)
	view.CompanyID = knownCompanyID(view.CompanyID, companies)
	if view.BoughtOn == "" {
		view.BoughtOn = time.Now().Format("2006-01-02")
	}
	return view, nil
}

func viewToRawJSON(view ocrView) (string, error) {
	bill := ocr.Bill{
		BoughtOn:  view.BoughtOn,
		Notes:     view.Notes,
		CompanyID: view.CompanyID,
	}
	for _, line := range view.Lines {
		bill.Lines = append(bill.Lines, ocr.Line{
			ReceiptName: line.ReceiptName,
			ProductName: line.ProductName,
			ProductID:   line.ProductID,
			UnitID:      line.UnitID,
			Quantity:    line.Quantity,
			Amount:      line.Amount,
			Skip:        !line.Include,
		})
	}
	raw, err := json.Marshal(bill)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func parseOCRView(get func(string) string) ocrView {
	view := ocrView{
		RecipeID:  formInt(get("recipe_id")),
		ImagePath: strings.TrimSpace(get("image_path")),
		BoughtOn:  strings.TrimSpace(get("bought_on")),
		Notes:     strings.TrimSpace(get("notes")),
		CompanyID: formInt(get("company_id")),
	}
	n, _ := strconv.Atoi(strings.TrimSpace(get("line_count")))
	if n < 0 {
		n = 0
	}
	if n > 200 {
		n = 200
	}
	for i := 0; i < n; i++ {
		p := strconv.Itoa(i)
		choice := strings.TrimSpace(get("product_choice_" + p))
		var productID int64
		if choice != "" && choice != "new" {
			productID, _ = strconv.ParseInt(choice, 10, 64)
		}
		view.Lines = append(view.Lines, ocrLineView{
			Include:     get("include_"+p) == "1",
			ProductID:   productID,
			ProductName: strings.TrimSpace(get("product_name_" + p)),
			UnitID:      formInt(get("unit_id_" + p)),
			Quantity:    strings.TrimSpace(get("quantity_" + p)),
			Amount:      strings.TrimSpace(get("amount_" + p)),
			ReceiptName: strings.TrimSpace(get("receipt_name_" + p)),
		})
	}
	return view
}

func parseOCRForm(get func(string) string) (store.BillImport, ocrView, string) {
	view := parseOCRView(get)
	if _, err := time.Parse("2006-01-02", view.BoughtOn); err != nil {
		return store.BillImport{}, view, "Date must be a valid day."
	}

	in := store.BillImport{BoughtOn: view.BoughtOn, CompanyID: view.CompanyID}
	for i, line := range view.Lines {
		if !line.Include {
			continue
		}
		qty, err := parseDecimal(line.Quantity, 8, false)
		if err != nil {
			return store.BillImport{}, view, fmt.Sprintf("Line %d: quantity %s.", i+1, err.Error())
		}
		amount, err := parseDecimal(line.Amount, 2, true)
		if err != nil {
			return store.BillImport{}, view, fmt.Sprintf("Line %d: amount %s.", i+1, err.Error())
		}
		item := store.BillLineInput{Quantity: qty, Amount: amount}
		if line.ProductID > 0 {
			item.ProductID = line.ProductID
		} else {
			if line.ProductName == "" {
				return store.BillImport{}, view, fmt.Sprintf("Line %d: name is required for a new product.", i+1)
			}
			if line.UnitID <= 0 {
				return store.BillImport{}, view, fmt.Sprintf("Line %d: choose a unit for the new product.", i+1)
			}
			item.ProductName = line.ProductName
			item.UnitID = line.UnitID
		}
		in.Lines = append(in.Lines, item)
	}
	if len(in.Lines) == 0 {
		return store.BillImport{}, view, "Tick at least one product."
	}
	return in, view, ""
}

func formInt(s string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return v
}

func knownCompanyID(id int64, companies []store.Company) int64 {
	if id <= 0 {
		return 0
	}
	for _, c := range companies {
		if c.ID == id {
			return id
		}
	}
	return 0
}

func unitKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".")
	return s
}
