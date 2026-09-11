package web

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"

	"github.com/adrian/bulkly/internal/store"
)

var errBiedronkaTooLarge = errors.New("response too large")

const (
	biedronkaAPIBase  = "https://api.prod.biedronka.cloud/api/v7"
	biedronkaTokenURL = "https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/token"
	biedronkaAPIUA    = "Android/2.22.2"
	biedronkaAuthUA   = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
	biedronkaClientID = "cma20"
	biedronkaRedirect = "app://cma20.biedronka.pl"
	biedronkaMaxBody  = 5 << 20
)

func (s *Server) biedronka(c *gin.Context) {
	state := s.biedronkaImportedState()
	raw, err := json.Marshal(state)
	if err != nil {
		raw = []byte(`{"ids":[],"since":""}`)
	}
	c.HTML(http.StatusOK, "biedronka.html", gin.H{
		"Page":         s.page("Biedronka", "", ""),
		"ImportedJSON": string(raw),
	})
}

func (s *Server) biedronkaImported(c *gin.Context) {
	c.JSON(http.StatusOK, s.biedronkaImportedState())
}

type biedronkaImported struct {
	IDs   []string `json:"ids"`
	Since string   `json:"since"`
}

func (s *Server) biedronkaImportedState() biedronkaImported {
	ids, err := s.store.ListReceiptExternalIDs(store.ReceiptSourceBiedronka)
	if err != nil || ids == nil {
		ids = []string{}
	}
	since, _ := s.store.LatestSourcedBoughtOn(store.ReceiptSourceBiedronka)
	return biedronkaImported{IDs: ids, Since: since}
}

func (s *Server) biedronkaTransactions(c *gin.Context) {
	page := strings.TrimSpace(c.Query("page"))
	if page == "" {
		page = "1"
	}
	n, err := strconv.Atoi(page)
	if err != nil || n < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
		return
	}
	s.proxyBiedronka(c, http.MethodGet, s.biedronkaAPIURL("transactions/"), url.Values{"page": {strconv.Itoa(n)}}, nil, nil)
}

func (s *Server) biedronkaTransaction(c *gin.Context) {
	id, ok := biedronkaTxID(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	s.proxyBiedronka(c, http.MethodGet, s.biedronkaAPIURL("transactions/"+id+"/"), nil, nil, nil)
}

func (s *Server) biedronkaEReceipt(c *gin.Context) {
	id, ok := biedronkaTxID(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	format, ok := biedronkaOutputFormat(c.Query("format"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid format"})
		return
	}
	extra := map[string]string{"output-format": format}
	if format == "pdf" {
		extra["Accept"] = "application/pdf"
	}
	s.proxyBiedronka(c, http.MethodGet, s.biedronkaAPIURL("transactions/"+id+"/e-receipt/"), nil, extra, nil)
}

func biedronkaOutputFormat(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "json":
		return "json", true
	case "pdf":
		return "pdf", true
	default:
		return "", false
	}
}

func (s *Server) biedronkaToken(c *gin.Context) {
	in, err := parseBiedronkaTokenReq(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid token request"})
		return
	}
	grant := strings.TrimSpace(in.GrantType)
	if grant == "" {
		grant = "refresh_token"
	}
	form := url.Values{
		"client_id":    {biedronkaClientID},
		"redirect_uri": {biedronkaRedirect},
	}
	switch grant {
	case "refresh_token":
		refresh := strings.TrimSpace(in.RefreshToken)
		if refresh == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "refresh_token is required"})
			return
		}
		form.Set("grant_type", "refresh_token")
		form.Set("refresh_token", refresh)
	case "authorization_code":
		code, ok := biedronkaAuthCode(in.Code)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing auth code"})
			return
		}
		verifier := strings.TrimSpace(in.CodeVerifier)
		if verifier == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "code_verifier is required"})
			return
		}
		form.Set("grant_type", "authorization_code")
		form.Set("code", code)
		form.Set("code_verifier", verifier)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported grant"})
		return
	}
	s.proxyBiedronka(c, http.MethodPost, s.biedronkaAuthURL(), nil, map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
		"User-Agent":   biedronkaAuthUA,
	}, strings.NewReader(form.Encode()))
}

type biedronkaTokenReq struct {
	GrantType    string `json:"grant_type"`
	RefreshToken string `json:"refresh_token"`
	Code         string `json:"code"`
	CodeVerifier string `json:"code_verifier"`
}

func parseBiedronkaTokenReq(c *gin.Context) (biedronkaTokenReq, error) {
	if strings.Contains(c.ContentType(), "json") {
		var in biedronkaTokenReq
		if err := c.ShouldBindJSON(&in); err != nil {
			return biedronkaTokenReq{}, err
		}
		return in, nil
	}
	if err := c.Request.ParseForm(); err != nil {
		return biedronkaTokenReq{}, err
	}
	return biedronkaTokenReq{
		GrantType:    c.PostForm("grant_type"),
		RefreshToken: c.PostForm("refresh_token"),
		Code:         c.PostForm("code"),
		CodeVerifier: c.PostForm("code_verifier"),
	}, nil
}

// biedronkaAuthCode extracts an OAuth code from a raw code, an app:// redirect,
// or a noisy copy that contains that URL.
func biedronkaAuthCode(value string) (string, bool) {
	raw := strings.TrimSpace(value)
	raw = strings.Trim(raw, `"'`)
	if raw == "" {
		return "", false
	}
	if i := strings.Index(raw, "app://"); i >= 0 {
		raw = raw[i:]
		if j := strings.IndexAny(raw, " \t\n\r"); j >= 0 {
			raw = raw[:j]
		}
		raw = strings.TrimRight(raw, `.,;"'`)
	}
	if strings.Contains(raw, "://") || strings.HasPrefix(raw, "app:") || strings.Contains(raw, "code=") {
		return biedronkaCodeFromRedirect(raw)
	}
	return raw, true
}

func biedronkaCodeFromRedirect(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	q := u.Query()
	code := strings.TrimSpace(q.Get("code"))
	if code == "" && u.Fragment != "" {
		fq, err := url.ParseQuery(u.Fragment)
		if err != nil {
			return "", false
		}
		code = strings.TrimSpace(fq.Get("code"))
	}
	if code == "" {
		return "", false
	}
	return code, true
}

func (s *Server) proxyBiedronka(c *gin.Context, method, rawURL string, query url.Values, extra map[string]string, body io.Reader) {
	auth := strings.TrimSpace(c.GetHeader("Authorization"))
	if method != http.MethodPost && auth == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}
	if method == http.MethodPost {
		auth = ""
	}
	status, ct, payload, err := s.biedronkaDo(c.Request.Context(), method, rawURL, query, extra, body, auth)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach Biedronka"})
		return
	}
	c.Data(status, ct, payload)
}

func (s *Server) biedronkaDo(ctx context.Context, method, rawURL string, query url.Values, extra map[string]string, body io.Reader, auth string) (int, string, []byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0, "", nil, err
	}
	if query != nil {
		parsed.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, parsed.String(), body)
	if err != nil {
		return 0, "", nil, err
	}
	req.Header.Set("User-Agent", biedronkaAPIUA)
	req.Header.Set("Accept-Language", "pl-PL")
	req.Header.Set("Accept", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	resp, err := s.biedronkaClient().Do(req)
	if err != nil {
		return 0, "", nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, biedronkaMaxBody+1))
	if err != nil {
		return 0, "", nil, err
	}
	if int64(len(payload)) > biedronkaMaxBody {
		return 0, "", nil, errBiedronkaTooLarge
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	return resp.StatusCode, ct, payload, nil
}

func (s *Server) biedronkaClient() *http.Client {
	if s.biedronkaHTTP != nil {
		return s.biedronkaHTTP
	}
	return http.DefaultClient
}

func (s *Server) biedronkaAPIURL(path string) string {
	base := strings.TrimRight(s.biedronkaAPI, "/")
	if base == "" {
		base = biedronkaAPIBase
	}
	return base + "/" + strings.TrimLeft(path, "/")
}

func (s *Server) biedronkaAuthURL() string {
	if s.biedronkaAuth != "" {
		return s.biedronkaAuth
	}
	return biedronkaTokenURL
}

func biedronkaTxID(raw string) (string, bool) {
	id := strings.TrimSpace(raw)
	if id == "" || len(id) > 128 {
		return "", false
	}
	for _, r := range id {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			continue
		}
		return "", false
	}
	return id, true
}
