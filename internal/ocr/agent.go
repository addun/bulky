package ocr

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
)

type Agent struct {
	cfg    Config
	client *openai.Client
}

func New(cfg Config) *Agent {
	cfg.BaseURL = normalizeBaseURL(cfg.BaseURL)
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if strings.TrimSpace(cfg.Model) == "" {
		cfg.Model = DefaultModel
	}
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	oai := openai.DefaultConfig(cfg.APIKey)
	oai.BaseURL = cfg.BaseURL
	oai.HTTPClient = &http.Client{Timeout: 90 * time.Second}
	return &Agent{
		cfg:    cfg,
		client: openai.NewClientWithConfig(oai),
	}
}

func (a *Agent) Configured() bool {
	return a != nil && a.cfg.Configured()
}

func (a *Agent) Extract(image []byte) (Bill, []byte, error) {
	if a == nil || !a.cfg.Configured() {
		return Bill{}, nil, ErrNotConfigured
	}
	jpeg, err := PrepareJPEG(image)
	if err != nil {
		return Bill{}, nil, err
	}
	body, err := a.chat(jpeg)
	if err != nil {
		return Bill{}, nil, err
	}
	rawJSON, err := extractJSON(body)
	if err != nil {
		return Bill{}, nil, err
	}
	bill, err := parseBill(body)
	if err != nil {
		return Bill{}, nil, err
	}
	if bill.NotABill {
		return Bill{}, rawJSON, ErrNotABill
	}
	if len(bill.ProductLines()) == 0 {
		return Bill{}, rawJSON, ErrNoLines
	}
	return bill, rawJSON, nil
}

func (a *Agent) chat(jpeg []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	resp, err := a.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:       a.cfg.Model,
		Temperature: 0,
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		},
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{
				Role: openai.ChatMessageRoleUser,
				MultiContent: []openai.ChatMessagePart{
					{Type: openai.ChatMessagePartTypeText, Text: userPrompt},
					{
						Type: openai.ChatMessagePartTypeImageURL,
						ImageURL: &openai.ChatMessageImageURL{
							URL:    "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpeg),
							Detail: openai.ImageURLDetailHigh,
						},
					},
				},
			},
		},
	})
	if err != nil {
		var apiErr *openai.APIError
		if errors.As(err, &apiErr) {
			msg := strings.TrimSpace(apiErr.Message)
			if msg == "" {
				msg = apiErr.Error()
			}
			return nil, fmt.Errorf("OCR model error: %s", msg)
		}
		return nil, fmt.Errorf("could not reach the OCR model: %w", err)
	}
	if len(resp.Choices) == 0 || strings.TrimSpace(resp.Choices[0].Message.Content) == "" {
		return nil, fmt.Errorf("OCR model returned no result")
	}
	return []byte(resp.Choices[0].Message.Content), nil
}

func normalizeBaseURL(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "/")
	s = strings.TrimSuffix(s, "/chat/completions")
	return s
}
