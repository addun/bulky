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
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	oai := openai.DefaultConfig(cfg.APIKey)
	oai.BaseURL = cfg.BaseURL
	oai.HTTPClient = &http.Client{Timeout: 3 * time.Minute}
	return &Agent{
		cfg:    cfg,
		client: openai.NewClientWithConfig(oai),
	}
}

func (a *Agent) Configured() bool {
	return a != nil && a.cfg.Configured()
}

func (a *Agent) WithModel(model string) *Agent {
	if a == nil {
		return nil
	}
	clone := *a
	clone.cfg.Model = strings.TrimSpace(model)
	return &clone
}

func (a *Agent) Extract(file []byte) (Bill, []byte, error) {
	if a == nil || !a.cfg.Configured() {
		return Bill{}, nil, ErrNotConfigured
	}
	if a.cfg.Model == "" {
		return Bill{}, nil, ErrNoModel
	}
	if len(file) == 0 {
		return Bill{}, nil, ErrNoImage
	}
	if len(file) > MaxImageBytes {
		return Bill{}, nil, fmt.Errorf("file must be 10 MB or smaller")
	}
	switch sniffFile(file) {
	case filePDF:
		return a.extractPDF(file)
	case fileImage:
		return a.extractImage(file)
	default:
		return Bill{}, nil, fmt.Errorf("file must be jpeg, png, webp, gif, or pdf")
	}
}

func (a *Agent) extractPDF(file []byte) (Bill, []byte, error) {
	text, _ := extractPDFText(file)
	if isPDFWithText(text) {
		return a.extractFromText(text)
	}
	text, err := scanPDFText(file)
	if err != nil {
		return Bill{}, nil, err
	}
	return a.extractFromText(text)
}

func (a *Agent) extractFromText(text string) (Bill, []byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	body, err := a.complete(ctx, a.cfg.Model, textSystemPrompt, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: textUserPrompt(text),
	})
	if err != nil {
		return Bill{}, nil, err
	}
	return finishExtract(body)
}

func (a *Agent) extractImage(file []byte) (Bill, []byte, error) {
	jpeg, err := PrepareJPEG(file)
	if err != nil {
		return Bill{}, nil, err
	}
	tiles, err := splitReceipt(jpeg)
	if err != nil {
		return Bill{}, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	body, err := a.chat(ctx, tiles)
	if err != nil {
		return Bill{}, nil, err
	}
	return finishExtract(body)
}

func finishExtract(body []byte) (Bill, []byte, error) {
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

func (a *Agent) chat(ctx context.Context, tiles [][]byte) ([]byte, error) {
	parts := []openai.ChatMessagePart{
		{Type: openai.ChatMessagePartTypeText, Text: chunkUserPrompt(len(tiles))},
	}
	for i, tile := range tiles {
		if len(tiles) > 1 {
			parts = append(parts, openai.ChatMessagePart{
				Type: openai.ChatMessagePartTypeText,
				Text: sliceCaption(i, len(tiles)),
			})
		}
		parts = append(parts, openai.ChatMessagePart{
			Type: openai.ChatMessagePartTypeImageURL,
			ImageURL: &openai.ChatMessageImageURL{
				URL:    "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(tile),
				Detail: openai.ImageURLDetailHigh,
			},
		})
	}
	return a.complete(ctx, a.cfg.Model, systemPrompt, openai.ChatCompletionMessage{
		Role:         openai.ChatMessageRoleUser,
		MultiContent: parts,
	})
}

func (a *Agent) complete(ctx context.Context, model string, system string, user openai.ChatCompletionMessage) ([]byte, error) {
	resp, err := a.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:       model,
		Temperature: 0,
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		},
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: system},
			user,
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
