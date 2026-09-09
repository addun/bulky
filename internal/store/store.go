package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	_ "modernc.org/sqlite"

	"github.com/adrian/bulkly/internal/match"
	"github.com/adrian/bulkly/internal/store/sqlc"
)

var (
	ErrNotFound               = errors.New("not found")
	ErrUnitInUse              = errors.New("unit is in use")
	ErrStoryInUse             = errors.New("story is in use")
	ErrDuplicate              = errors.New("already exists")
	ErrInvalidUnit            = errors.New("invalid unit")
	ErrInvalidStory           = errors.New("invalid story")
	ErrStoryName              = errors.New("story name required")
	ErrStoryStreet            = errors.New("story street name required")
	ErrStoryBuilding          = errors.New("story building number required")
	ErrStoryPostal            = errors.New("story postal code required")
	ErrStoryCity              = errors.New("story city required")
	ErrInvalidKind            = errors.New("invalid purchase kind")
	ErrInvalidQuantity        = errors.New("quantity must be greater than zero")
	ErrInvalidAlias           = errors.New("alias is required")
	ErrAliasScope             = errors.New("alias cannot be both story and chain")
	ErrInvalidSetting         = errors.New("invalid setting")
	ErrSameProduct            = errors.New("cannot merge a product into itself")
	ErrUnitMismatch           = errors.New("products use different units")
	ErrInvalidConversion      = errors.New("invalid unit conversion")
	ErrConversionMismatch     = errors.New("products convert to a unit differently")
	ErrComparisonGroupName    = errors.New("comparison group name required")
	ErrInvalidComparisonGroup = errors.New("invalid comparison group")
)

type PurchaseKind string

const (
	KindPurchase PurchaseKind = "purchase"
	KindPrice    PurchaseKind = "price"
)

func ParsePurchaseKind(s string) (PurchaseKind, error) {
	switch PurchaseKind(strings.TrimSpace(s)) {
	case KindPurchase:
		return KindPurchase, nil
	case KindPrice:
		return KindPrice, nil
	default:
		return "", ErrInvalidKind
	}
}

type Store struct {
	db      *sql.DB
	q       *sqlc.Queries
	dataDir string
}

type Unit struct {
	ID           int64
	Name         string
	ProductCount int
}

type Product struct {
	ID          int64
	Name        string
	UnitID      int64
	UnitName    string
	ImagePath   sql.NullString
	CreatedAt   string
	Conversions []ProductConversion
}

type ProductListItem struct {
	Product
	LastBought     sql.NullString
	LifetimeAmount decimal.Decimal
	PurchaseCount  int
	Quote          *QuotedPrice
}

type Story struct {
	ID              int64
	Name            string
	StreetName      string
	BuildingNumber  string
	ApartmentNumber string
	PostalCode      string
	City            string
	ExternalID      string
	RetailChainID   int64
	RetailChainName string
	PurchaseCount   int
}

func (c Story) StreetLine() string {
	s := strings.TrimSpace(c.StreetName + " " + c.BuildingNumber)
	if c.ApartmentNumber != "" {
		s += "/" + c.ApartmentNumber
	}
	return s
}

func (c Story) AddressLine() string {
	street := c.StreetLine()
	loc := strings.TrimSpace(c.PostalCode + " " + c.City)
	switch {
	case street != "" && loc != "":
		return street + ", " + loc
	case street != "":
		return street
	default:
		return loc
	}
}

func (c Story) Label() string {
	addr := c.AddressLine()
	if addr == "" {
		return c.Name
	}
	return c.Name + " — " + addr
}

type Purchase struct {
	ID        int64
	ProductID int64
	StoryID   int64
	Kind      PurchaseKind
	ReceiptID int64
	BoughtOn  string
	Quantity  decimal.Decimal
	Amount    decimal.Decimal
	CreatedAt string
}

type ReceiptPurchase struct {
	Purchase
	ProductName string
	UnitName    string
	ImagePath   sql.NullString
}

func (p Purchase) IsPurchase() bool { return p.Kind == KindPurchase }
func (p Purchase) IsPrice() bool    { return p.Kind == KindPrice }

type YearSummary struct {
	Year     string
	Quantity decimal.Decimal
	Amount   decimal.Decimal
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "images"), 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "bulkly.db")
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db, q: sqlc.New(db), dataDir: dataDir}
	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DataDir() string {
	return s.dataDir
}

func (s *Store) ImagesDir() string {
	return filepath.Join(s.dataDir, "images")
}

// ImmediateTx runs fn in one SQLite transaction. The pool is a single
// connection, so later queries on Store use the same txn.
func (s *Store) ImmediateTx(fn func() error) error {
	if _, err := s.db.Exec("BEGIN IMMEDIATE"); err != nil {
		return err
	}
	if err := fn(); err != nil {
		_, _ = s.db.Exec("ROLLBACK")
		return err
	}
	_, err := s.db.Exec("COMMIT")
	return err
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func (s *Store) ListStories() ([]Story, error) {
	rows, err := s.q.ListStories(ctx())
	if err != nil {
		return nil, err
	}
	return mapStories(rows), nil
}

func (s *Store) GetStory(id int64) (Story, error) {
	return getStory(s.q, id)
}

func (s *Store) CreateStory(name, streetName, building, apartment, postalCode, city, externalID string, retailChainID int64) (Story, error) {
	c, err := normalizeStory(name, streetName, building, apartment, postalCode, city, externalID)
	if err != nil {
		return Story{}, err
	}
	id, err := insertStory(s.q, c, retailChainID)
	if err != nil {
		return Story{}, err
	}
	return s.GetStory(id)
}

func (s *Store) UpdateStory(id int64, name, streetName, building, apartment, postalCode, city, externalID string, retailChainID int64) error {
	c, err := normalizeStory(name, streetName, building, apartment, postalCode, city, externalID)
	if err != nil {
		return err
	}
	chain, err := optionalChain(s.q, retailChainID)
	if err != nil {
		return err
	}
	n, err := s.q.UpdateStory(ctx(), sqlc.UpdateStoryParams{
		Name:            c.Name,
		StreetName:      c.StreetName,
		BuildingNumber:  c.BuildingNumber,
		ApartmentNumber: c.ApartmentNumber,
		PostalCode:      c.PostalCode,
		City:            c.City,
		ExternalID:      c.ExternalID,
		RetailChainID:   chain,
		ID:              id,
	})
	if err != nil {
		if isUniqueErr(err) {
			return ErrDuplicate
		}
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func insertStory(q *sqlc.Queries, c Story, retailChainID int64) (int64, error) {
	chain, err := optionalChain(q, retailChainID)
	if err != nil {
		return 0, err
	}
	id, err := q.InsertStory(ctx(), sqlc.InsertStoryParams{
		Name:            c.Name,
		StreetName:      c.StreetName,
		BuildingNumber:  c.BuildingNumber,
		ApartmentNumber: c.ApartmentNumber,
		PostalCode:      c.PostalCode,
		City:            c.City,
		ExternalID:      c.ExternalID,
		RetailChainID:   chain,
	})
	if err != nil {
		if isUniqueErr(err) {
			return 0, ErrDuplicate
		}
		return 0, err
	}
	return id, nil
}

func (s *Store) DeleteStory(id int64) error {
	c, err := s.GetStory(id)
	if err != nil {
		return err
	}
	if c.PurchaseCount > 0 {
		return ErrStoryInUse
	}
	n, err := s.q.DeleteStory(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListProducts(q string) ([]ProductListItem, error) {
	return s.listProducts(q, time.Now(), 0)
}

func (s *Store) listProducts(q string, now time.Time, limit int) ([]ProductListItem, error) {
	q = strings.TrimSpace(q)
	rows, err := s.q.ListProducts(ctx())
	if err != nil {
		return nil, err
	}
	items := make([]ProductListItem, len(rows))
	index := map[int64]int{}
	for i, r := range rows {
		items[i] = ProductListItem{
			Product:        mapListProduct(r),
			LifetimeAmount: decimal.Zero,
		}
		index[r.ID] = i
	}
	if len(items) == 0 {
		return items, nil
	}

	prows, err := s.q.ListPurchaseAmounts(ctx(), string(KindPurchase))
	if err != nil {
		return nil, err
	}
	for _, pr := range prows {
		i, ok := index[pr.ProductID]
		if !ok {
			continue
		}
		d, err := decimal.NewFromString(pr.Amount)
		if err != nil {
			return nil, err
		}
		items[i].LifetimeAmount = items[i].LifetimeAmount.Add(d)
		items[i].PurchaseCount++
		if !items[i].LastBought.Valid || pr.BoughtOn > items[i].LastBought.String {
			items[i].LastBought = sql.NullString{String: pr.BoughtOn, Valid: true}
		}
	}
	if err := attachItemConversions(s.q, items); err != nil {
		return nil, err
	}
	if q != "" {
		aliases, err := s.ListAliases()
		if err != nil {
			return nil, err
		}
		items = filterProductSearch(items, q, aliases)
	}
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	if err := attachProductQuotes(s.q, items, now); err != nil {
		return nil, err
	}
	return items, nil
}

func filterProductSearch(items []ProductListItem, q string, aliases []ProductAlias) []ProductListItem {
	labels := map[int64][]string{}
	for _, a := range aliases {
		labels[a.ProductID] = append(labels[a.ProductID], a.Alias)
	}
	type hit struct {
		item  ProductListItem
		score float64
	}
	var hits []hit
	for _, it := range items {
		labs := append([]string{it.Name}, labels[it.ID]...)
		score := match.Search(q, labs...)
		if score <= 0 {
			continue
		}
		hits = append(hits, hit{it, score})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return strings.ToLower(hits[i].item.Name) < strings.ToLower(hits[j].item.Name)
	})
	out := make([]ProductListItem, len(hits))
	for i, h := range hits {
		out[i] = h.item
	}
	return out
}

func (s *Store) GetProduct(id int64) (Product, error) {
	p, err := getProduct(s.q, id)
	if err != nil {
		return Product{}, err
	}
	if err := attachProductConversions(s.q, &p); err != nil {
		return Product{}, err
	}
	return p, nil
}

func (s *Store) CreateProduct(name string, unitID int64, imagePath *string, conversions ...[]ProductConversion) (Product, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Product{}, fmt.Errorf("name is required")
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return Product{}, ErrInvalidUnit
		}
		return Product{}, err
	}
	taken, err := s.aliasExists(name)
	if err != nil {
		return Product{}, err
	}
	if taken {
		return Product{}, ErrDuplicate
	}
	var convs []ProductConversion
	if len(conversions) > 0 {
		convs = conversions[0]
	}
	var id int64
	err = s.withTx(func(q *sqlc.Queries) error {
		var err error
		id, err = q.InsertProduct(ctx(), sqlc.InsertProductParams{
			Name:      name,
			UnitID:    unitID,
			ImagePath: nullStringPtr(imagePath),
			CreatedAt: nowRFC3339(),
		})
		if err != nil {
			return err
		}
		return setProductConversions(q, id, unitID, convs)
	})
	if err != nil {
		return Product{}, err
	}
	return s.GetProduct(id)
}

func (s *Store) UpdateProduct(id int64, name string, unitID int64, imagePath *string, clearImage bool, conversions ...[]ProductConversion) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is required")
	}
	if _, err := s.GetUnit(unitID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrInvalidUnit
		}
		return err
	}
	taken, err := aliasExistsExcept(s.q, name, id)
	if err != nil {
		return err
	}
	if taken {
		return ErrDuplicate
	}
	cur, err := s.GetProduct(id)
	if err != nil {
		return err
	}
	if unitID != cur.UnitID {
		return ErrInvalidUnit
	}
	var path sql.NullString
	switch {
	case clearImage:
		path = sql.NullString{}
	case imagePath != nil:
		path = sql.NullString{String: *imagePath, Valid: true}
	default:
		path = cur.ImagePath
	}
	return s.withTx(func(q *sqlc.Queries) error {
		n, err := q.UpdateProduct(ctx(), sqlc.UpdateProductParams{
			Name:      name,
			UnitID:    unitID,
			ImagePath: path,
			ID:        id,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		if len(conversions) > 0 {
			return setProductConversions(q, id, unitID, conversions[0])
		}
		return nil
	})
}

func (s *Store) DeleteProduct(id int64) (imageName string, err error) {
	p, err := s.GetProduct(id)
	if err != nil {
		return "", err
	}
	if err := s.q.DeleteProduct(ctx(), id); err != nil {
		return "", err
	}
	if p.ImagePath.Valid {
		return p.ImagePath.String, nil
	}
	return "", nil
}

func (s *Store) ListPurchases(productID int64) ([]Purchase, error) {
	rows, err := s.q.ListPurchasesByProduct(ctx(), productID)
	if err != nil {
		return nil, err
	}
	return mapPurchases(rows)
}

func (s *Store) ListPurchasesByReceipt(receiptID int64) ([]ReceiptPurchase, error) {
	rows, err := s.q.ListPurchasesByReceipt(ctx(), nullID(receiptID))
	if err != nil {
		return nil, err
	}
	return mapReceiptPurchases(rows)
}

func (s *Store) GetPurchase(id int64) (Purchase, error) {
	return getPurchase(s.q, id)
}

func (s *Store) CreatePurchase(productID, storyID int64, boughtOn string, quantity, amount decimal.Decimal, kind PurchaseKind) (Purchase, error) {
	if _, err := s.GetProduct(productID); err != nil {
		return Purchase{}, err
	}
	if _, err := ParsePurchaseKind(string(kind)); err != nil {
		return Purchase{}, err
	}
	story, err := optionalStory(s.q, storyID)
	if err != nil {
		return Purchase{}, err
	}
	if err := validQuantity(quantity); err != nil {
		return Purchase{}, err
	}
	boughtOn, err = NormalizeBoughtOn(boughtOn)
	if err != nil {
		return Purchase{}, err
	}
	id, err := s.q.InsertPurchase(ctx(), sqlc.InsertPurchaseParams{
		ProductID: productID,
		StoryID:   story,
		Kind:      string(kind),
		ReceiptID: sql.NullInt64{},
		BoughtOn:  boughtOn,
		Quantity:  quantity.String(),
		Amount:    amount.String(),
		CreatedAt: nowRFC3339(),
	})
	if err != nil {
		return Purchase{}, err
	}
	return s.GetPurchase(id)
}

func (s *Store) UpdatePurchase(id, storyID int64, boughtOn string, quantity, amount decimal.Decimal, kind PurchaseKind) error {
	if _, err := ParsePurchaseKind(string(kind)); err != nil {
		return err
	}
	story, err := optionalStory(s.q, storyID)
	if err != nil {
		return err
	}
	if err := validQuantity(quantity); err != nil {
		return err
	}
	boughtOn, err = NormalizeBoughtOn(boughtOn)
	if err != nil {
		return err
	}
	n, err := s.q.UpdatePurchase(ctx(), sqlc.UpdatePurchaseParams{
		StoryID:  story,
		Kind:     string(kind),
		BoughtOn: boughtOn,
		Quantity: quantity.String(),
		Amount:   amount.String(),
		ID:       id,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeletePurchase(id int64) error {
	n, err := s.q.DeletePurchase(ctx(), id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func YearlySummaries(purchases []Purchase) []YearSummary {
	order := []string{}
	byYear := map[string]*YearSummary{}
	for _, p := range purchases {
		if !p.IsPurchase() {
			continue
		}
		year := p.BoughtOn
		if len(year) >= 4 {
			year = year[:4]
		}
		s, ok := byYear[year]
		if !ok {
			s = &YearSummary{Year: year, Quantity: decimal.Zero, Amount: decimal.Zero}
			byYear[year] = s
			order = append(order, year)
		}
		s.Quantity = s.Quantity.Add(p.Quantity)
		s.Amount = s.Amount.Add(p.Amount)
	}
	out := make([]YearSummary, 0, len(order))
	seen := map[string]bool{}
	for _, y := range order {
		if seen[y] {
			continue
		}
		seen[y] = true
		out = append(out, *byYear[y])
	}
	return out
}

func validQuantity(quantity decimal.Decimal) error {
	if quantity.IsZero() || quantity.IsNegative() {
		return ErrInvalidQuantity
	}
	return nil
}

func normalizeStory(name, streetName, building, apartment, postalCode, city, externalID string) (Story, error) {
	c := Story{
		Name:            strings.TrimSpace(name),
		StreetName:      strings.TrimSpace(streetName),
		BuildingNumber:  strings.TrimSpace(building),
		ApartmentNumber: strings.TrimSpace(apartment),
		PostalCode:      strings.TrimSpace(postalCode),
		City:            strings.TrimSpace(city),
		ExternalID:      strings.TrimSpace(externalID),
	}
	if c.Name == "" {
		return Story{}, ErrStoryName
	}
	if c.StreetName == "" {
		return Story{}, ErrStoryStreet
	}
	if c.BuildingNumber == "" {
		return Story{}, ErrStoryBuilding
	}
	if c.PostalCode == "" {
		return Story{}, ErrStoryPostal
	}
	if c.City == "" {
		return Story{}, ErrStoryCity
	}
	return c, nil
}

func isUniqueErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
