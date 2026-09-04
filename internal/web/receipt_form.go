package web

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/match"
	"github.com/adrian/bulkly/internal/ocr"
	"github.com/adrian/bulkly/internal/store"
)

type receiptView struct {
	ReceiptID       int64
	ImagePath       string
	Status          string
	BoughtOn        string
	BoughtAt        string
	Notes           string
	StoryID         int64
	StoryName       string
	ExternalID      string
	StreetName      string
	BuildingNumber  string
	ApartmentNumber string
	PostalCode      string
	City            string
	Lines           []receiptLineView
}

func (v receiptView) Migrated() bool {
	return v.Status == store.ReceiptMigrated
}

func (v receiptView) AddressLine() string {
	c := store.Story{
		StreetName:      v.StreetName,
		BuildingNumber:  v.BuildingNumber,
		ApartmentNumber: v.ApartmentNumber,
		PostalCode:      v.PostalCode,
		City:            v.City,
	}
	addr := c.AddressLine()
	if v.StoryName == "" {
		return addr
	}
	if addr == "" {
		return v.StoryName
	}
	return v.StoryName + " — " + addr
}

func (v receiptView) CreateStoryURL() string {
	if v.Migrated() || v.StoryID != 0 || v.ReceiptID <= 0 {
		return ""
	}
	if strings.TrimSpace(v.StoryName) == "" && strings.TrimSpace(v.StreetName) == "" && strings.TrimSpace(v.City) == "" && strings.TrimSpace(v.ExternalID) == "" {
		return ""
	}
	q := url.Values{}
	set := func(key, val string) {
		if s := strings.TrimSpace(val); s != "" {
			q.Set(prefillQuery(key), s)
		}
	}
	set("name", v.StoryName)
	set("external_id", v.ExternalID)
	set("street_name", v.StreetName)
	set("building_number", v.BuildingNumber)
	set("apartment_number", v.ApartmentNumber)
	set("postal_code", v.PostalCode)
	set("city", v.City)
	q.Set("next", "/admin/receipts/"+strconv.FormatInt(v.ReceiptID, 10))
	return "/admin/stories/new?" + q.Encode()
}

type receiptLineView struct {
	Include      bool
	ProductID    int64
	ProductName  string
	UnitID       int64
	PackageCount string
	PackageSize  string
	Amount       string
	ReceiptName  string
	VatType      string
	UnitPrice    string
	Discount     string
}

func hydrateBill(bill ocr.Bill, products []store.ProductListItem, units []store.Unit, aliases []store.ProductAlias, chainID int64) ocr.Bill {
	productByID := map[int64]store.ProductListItem{}
	var names []match.Label
	for _, p := range products {
		productByID[p.ID] = p
		names = append(names, match.Label{ProductID: p.ID, Text: p.Name})
	}
	var shop, chain, global []match.Label
	for _, a := range aliases {
		lab := match.Label{ProductID: a.ProductID, Text: a.Alias}
		switch {
		case a.StoryID > 0:
			if a.StoryID == bill.StoryID {
				shop = append(shop, lab)
			}
		case a.RetailChainID > 0:
			if chainID > 0 && a.RetailChainID == chainID {
				chain = append(chain, lab)
			}
		default:
			global = append(global, lab)
		}
	}
	unitByID := map[int64]store.Unit{}
	unitByName := map[string]store.Unit{}
	for _, u := range units {
		unitByID[u.ID] = u
		unitByName[unitKey(u.Name)] = u
	}

	for i, line := range bill.Lines {
		fromUnit := lineUnitID(line, unitByID, unitByName)
		if line.ProductID != 0 {
			if p, ok := productByID[line.ProductID]; ok {
				line.ProductID = p.ID
				if line.ProductName == "" {
					line.ProductName = p.Name
				}
				applyPurchaseUnit(&line, p.Product, fromUnit)
			} else {
				line.ProductID = 0
			}
		}
		if line.ProductID == 0 {
			if p, ok := matchLineProduct(line.ReceiptName, line.ProductName, shop, chain, global, names, productByID); ok {
				line.ProductID = p.ID
				applyPurchaseUnit(&line, p.Product, fromUnit)
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

func lineUnitID(line ocr.Line, unitByID map[int64]store.Unit, unitByName map[string]store.Unit) int64 {
	if _, ok := unitByID[line.UnitID]; ok {
		return line.UnitID
	}
	if u, ok := unitByName[unitKey(line.UnitName)]; ok {
		return u.ID
	}
	return 0
}

func applyPurchaseUnit(line *ocr.Line, p store.Product, fromUnit int64) {
	if fromUnit == 0 {
		fromUnit = line.UnitID
	}
	count, size := linePackFields(*line)
	packs, err1 := parseDecimal(count, 8, false)
	packSize, err2 := parseDecimal(size, 8, false)
	if err1 == nil && err2 == nil {
		np, ns, converted := store.ConvertPacksToPrimary(packs, packSize, fromUnit, p)
		if converted {
			line.PackageCount = np.String()
			line.PackageSize = ns.String()
			line.Quantity = np.Mul(ns).String()
		}
	}
	line.UnitID = p.UnitID
}

func matchLineProduct(receiptName, productName string, shop, chain, global, names []match.Label, products map[int64]store.ProductListItem) (store.ProductListItem, bool) {
	for _, q := range []string{receiptName, productName} {
		id, ok := match.Product(q, shop, chain, global, names)
		if !ok {
			continue
		}
		if p, found := products[id]; found {
			return p, true
		}
	}
	return store.ProductListItem{}, false
}

func billToView(bill ocr.Bill, receiptID int64, imagePath, status string) receiptView {
	view := receiptView{
		ReceiptID:       receiptID,
		ImagePath:       imagePath,
		Status:          status,
		BoughtOn:        bill.BoughtOn,
		BoughtAt:        bill.BoughtAt,
		Notes:           bill.Notes,
		StoryID:         bill.StoryID,
		StoryName:       bill.StoryName,
		ExternalID:      bill.ExternalID,
		StreetName:      bill.StreetName,
		BuildingNumber:  bill.BuildingNumber,
		ApartmentNumber: bill.ApartmentNumber,
		PostalCode:      bill.PostalCode,
		City:            bill.City,
	}
	for _, line := range bill.ProductLines() {
		name := line.ProductName
		if name == "" {
			name = line.ReceiptName
		}
		packCount, packSize := linePackFields(line)
		view.Lines = append(view.Lines, receiptLineView{
			Include:      true,
			ProductID:    line.ProductID,
			ProductName:  name,
			UnitID:       line.UnitID,
			PackageCount: packCount,
			PackageSize:  packSize,
			Amount:       line.Amount,
			ReceiptName:  line.ReceiptName,
			VatType:      line.VatType,
			UnitPrice:    line.UnitPrice,
			Discount:     line.Discount,
		})
	}
	return view
}

func receiptToView(r store.Receipt, products []store.ProductListItem, units []store.Unit, stories []store.Story, aliases []store.ProductAlias) (receiptView, error) {
	var bill ocr.Bill
	if strings.TrimSpace(r.RawResponse) != "" {
		parsed, err := ocr.Parse([]byte(r.RawResponse))
		if err != nil {
			return receiptView{}, err
		}
		bill = parsed
		if bill.StoryID == 0 {
			bill.StoryID = matchStory(bill, stories)
		}
		bill = hydrateBill(bill, products, units, aliases, storyChainID(bill.StoryID, stories))
	}
	view := billToView(bill, r.ID, r.ImagePath, r.Status)
	view.StoryID = knownStoryID(view.StoryID, stories)
	if view.BoughtOn == "" {
		now := time.Now()
		view.BoughtOn = now.Format("2006-01-02")
		view.BoughtAt = now.Format("15:04")
	}
	return view, nil
}

func viewToRawJSON(view receiptView) (string, error) {
	bill := ocr.Bill{
		BoughtOn:        view.BoughtOn,
		BoughtAt:        view.BoughtAt,
		Notes:           view.Notes,
		StoryID:         view.StoryID,
		StoryName:       view.StoryName,
		ExternalID:      view.ExternalID,
		StreetName:      view.StreetName,
		BuildingNumber:  view.BuildingNumber,
		ApartmentNumber: view.ApartmentNumber,
		PostalCode:      view.PostalCode,
		City:            view.City,
	}
	for _, line := range view.Lines {
		bill.Lines = append(bill.Lines, ocr.Line{
			ReceiptName:  line.ReceiptName,
			ProductName:  line.ProductName,
			ProductID:    line.ProductID,
			UnitID:       line.UnitID,
			VatType:      line.VatType,
			PackageCount: line.PackageCount,
			PackageSize:  line.PackageSize,
			UnitPrice:    line.UnitPrice,
			Discount:     line.Discount,
			Amount:       line.Amount,
			Skip:         !line.Include,
		})
	}
	raw, err := json.Marshal(bill)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func parseReceiptView(get func(string) string) receiptView {
	view := receiptView{
		ReceiptID:       formInt(get("receipt_id")),
		ImagePath:       strings.TrimSpace(get("image_path")),
		BoughtOn:        strings.TrimSpace(get("bought_on")),
		BoughtAt:        strings.TrimSpace(get("bought_at")),
		Notes:           strings.TrimSpace(get("notes")),
		StoryID:         formInt(get("story_id")),
		StoryName:       strings.TrimSpace(get("story_name")),
		ExternalID:      strings.TrimSpace(get("external_id")),
		StreetName:      strings.TrimSpace(get("street_name")),
		BuildingNumber:  strings.TrimSpace(get("building_number")),
		ApartmentNumber: strings.TrimSpace(get("apartment_number")),
		PostalCode:      strings.TrimSpace(get("postal_code")),
		City:            strings.TrimSpace(get("city")),
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
		view.Lines = append(view.Lines, receiptLineView{
			Include:      get("include_"+p) == "1",
			ProductID:    productID,
			ProductName:  strings.TrimSpace(get("product_name_" + p)),
			UnitID:       formInt(get("unit_id_" + p)),
			PackageCount: strings.TrimSpace(get("packages_" + p)),
			PackageSize:  strings.TrimSpace(get("package_size_" + p)),
			Amount:       strings.TrimSpace(get("amount_" + p)),
			ReceiptName:  strings.TrimSpace(get("receipt_name_" + p)),
			VatType:      strings.TrimSpace(get("vat_type_" + p)),
			UnitPrice:    strings.TrimSpace(get("unit_price_" + p)),
			Discount:     strings.TrimSpace(get("discount_" + p)),
		})
	}
	return view
}

func parseReceiptForm(get func(string) string, products []store.ProductListItem) (store.BillImport, receiptView, string) {
	view := parseReceiptView(get)
	boughtOn, err := store.NormalizeBoughtOn(store.JoinBoughtOn(view.BoughtOn, view.BoughtAt))
	if err != nil {
		return store.BillImport{}, view, "Date must be a valid day."
	}
	view.BoughtOn = store.BoughtOnDate(boughtOn)
	view.BoughtAt = store.BoughtOnTime(boughtOn)

	byID := map[int64]store.ProductListItem{}
	for _, p := range products {
		byID[p.ID] = p
	}

	in := store.BillImport{BoughtOn: boughtOn, StoryID: view.StoryID}
	for i, line := range view.Lines {
		if !line.Include {
			continue
		}
		packages, err := parseDecimal(line.PackageCount, 8, false)
		if err != nil {
			return store.BillImport{}, view, fmt.Sprintf("Line %d: packages %s.", i+1, err.Error())
		}
		packSize, err := parseDecimal(line.PackageSize, 8, false)
		if err != nil {
			return store.BillImport{}, view, fmt.Sprintf("Line %d: package size %s.", i+1, err.Error())
		}
		if p, ok := byID[line.ProductID]; ok {
			packages, packSize, _ = store.ConvertPacksToPrimary(packages, packSize, line.UnitID, p.Product)
		}
		qty := packages.Mul(packSize)
		amount, err := parseDecimal(line.Amount, 2, true)
		if err != nil {
			return store.BillImport{}, view, fmt.Sprintf("Line %d: amount %s.", i+1, err.Error())
		}
		item := store.BillLineInput{Quantity: qty, PackageCount: packages, PackageSize: packSize, Amount: amount, ReceiptName: line.ReceiptName}
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

func knownStoryID(id int64, stories []store.Story) int64 {
	if id <= 0 {
		return 0
	}
	for _, c := range stories {
		if c.ID == id {
			return id
		}
	}
	return 0
}

func storyChainID(storyID int64, stories []store.Story) int64 {
	if storyID <= 0 {
		return 0
	}
	for _, c := range stories {
		if c.ID == storyID {
			return c.RetailChainID
		}
	}
	return 0
}

func matchStory(bill ocr.Bill, stories []store.Story) int64 {
	if id := matchStoryExternalID(bill, stories); id > 0 {
		return id
	}
	if id := matchStoryAddress(bill, stories); id > 0 {
		return id
	}
	return matchStoryName(bill, stories)
}

func matchStoryExternalID(bill ocr.Bill, stories []store.Story) int64 {
	want := strings.TrimSpace(bill.ExternalID)
	if want == "" {
		return 0
	}
	var hit int64
	for _, c := range stories {
		if c.ExternalID == "" || !strings.EqualFold(c.ExternalID, want) {
			continue
		}
		if hit != 0 && hit != c.ID {
			return 0
		}
		hit = c.ID
	}
	return hit
}

func matchStoryAddress(bill ocr.Bill, stories []store.Story) int64 {
	want := storyAddrKey(bill.StreetName, bill.BuildingNumber, bill.PostalCode, bill.City)
	if want == "" {
		return 0
	}
	var hit int64
	for _, c := range stories {
		if storyAddrKey(c.StreetName, c.BuildingNumber, c.PostalCode, c.City) != want {
			continue
		}
		if hit != 0 && hit != c.ID {
			return 0
		}
		hit = c.ID
	}
	return hit
}

func matchStoryName(bill ocr.Bill, stories []store.Story) int64 {
	name := match.Fold(bill.StoryName)
	if name == "" {
		return 0
	}
	city := match.Fold(bill.City)
	var hit int64
	for _, c := range stories {
		if match.Fold(c.Name) != name {
			continue
		}
		if city != "" && match.Fold(c.City) != city {
			continue
		}
		if hit != 0 && hit != c.ID {
			return 0
		}
		hit = c.ID
	}
	return hit
}

func storyAddrKey(street, building, postal, city string) string {
	street = match.Fold(stripStreetPrefix(street))
	building = match.Fold(building)
	postal = digitsOnly(postal)
	city = match.Fold(city)
	if street == "" || building == "" || postal == "" || city == "" {
		return ""
	}
	return street + "\x1f" + building + "\x1f" + postal + "\x1f" + city
}

func stripStreetPrefix(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	lower := strings.ToLower(s)
	for _, p := range []string{"ulica ", "ul. ", "ul ", "aleje ", "aleja ", "al. ", "al ", "plac ", "pl. ", "pl "} {
		if strings.HasPrefix(lower, p) {
			return strings.TrimSpace(s[len(p):])
		}
	}
	return s
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func receiptVisitFacts(r store.Receipt, buys []store.ReceiptPurchase, stories []store.Story) (boughtOn, boughtAt, notes string, story store.Story) {
	var bill ocr.Bill
	if strings.TrimSpace(r.RawResponse) != "" {
		if parsed, err := ocr.Parse([]byte(r.RawResponse)); err == nil {
			bill = parsed
		}
	}
	notes = bill.Notes
	boughtAt = bill.BoughtAt
	if len(buys) > 0 {
		return buys[0].BoughtOn, boughtAt, notes, storyByID(stories, buys[0].StoryID)
	}
	return bill.BoughtOn, boughtAt, notes, storyByID(stories, bill.StoryID)
}

func storyByID(stories []store.Story, id int64) store.Story {
	if id <= 0 {
		return store.Story{}
	}
	for _, c := range stories {
		if c.ID == id {
			return c
		}
	}
	return store.Story{}
}

func unitKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".")
	return s
}

func linePackFields(line ocr.Line) (count, size string) {
	count = strings.TrimSpace(line.PackageCount)
	size = strings.TrimSpace(line.PackageSize)
	if count != "" && size != "" {
		return count, size
	}
	if q := strings.TrimSpace(line.Quantity); q != "" {
		if count == "" {
			count = "1"
		}
		if size == "" {
			size = q
		}
	}
	return count, size
}
