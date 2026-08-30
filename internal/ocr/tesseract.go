package ocr

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ocrDPI     = "300"
	previewDPI = "150"
)

var lookPath = exec.LookPath

var runCommand = func(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("%s: %s", name, msg)
		}
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return out, nil
}

var scanPDFText = func(raw []byte) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	return ocrPDF(ctx, raw)
}

func hasPDFOCR() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return requirePDFOCR(ctx) == nil
}

func requirePDFOCR(ctx context.Context) error {
	if _, err := lookPath("tesseract"); err != nil {
		return errNeedDockerOCR()
	}
	if _, err := lookPath("pdftoppm"); err != nil {
		return errNeedDockerOCR()
	}
	if !tesseractHasPol(ctx) {
		return errMissingPol()
	}
	return nil
}

func tesseractHasPol(ctx context.Context) bool {
	out, err := runCommand(ctx, "tesseract", "--list-langs")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == "pol" {
			return true
		}
	}
	return false
}

func errNeedDockerOCR() error {
	return fmt.Errorf("%w: run Bulkly in Docker to read scanned PDFs", ErrNoPDFText)
}

func errMissingPol() error {
	return fmt.Errorf("tesseract is installed but Polish language data is missing (brew install tesseract-lang), or run Bulkly in Docker")
}

func ocrPDF(ctx context.Context, raw []byte) (string, error) {
	if err := requirePDFOCR(ctx); err != nil {
		return "", err
	}
	pages, cleanup, err := rasterizePDF(ctx, raw, ocrDPI, maxPDFPages)
	if err != nil {
		return "", err
	}
	defer cleanup()
	if len(pages) == 0 {
		return "", fmt.Errorf("could not rasterize the PDF")
	}
	var b strings.Builder
	for i, page := range pages {
		text, err := tesseractPage(ctx, page)
		if err != nil {
			return "", err
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		if len(pages) > 1 {
			fmt.Fprintf(&b, "--- page %d ---\n", i+1)
		}
		b.WriteString(text)
	}
	out := strings.TrimSpace(b.String())
	if !isPDFWithText(out) {
		return "", ErrNoPDFText
	}
	return out, nil
}

func rasterizePDF(ctx context.Context, raw []byte, dpi string, lastPage int) (pages []string, cleanup func(), err error) {
	dir, err := os.MkdirTemp("", "bulkly-pdf-")
	if err != nil {
		return nil, nil, err
	}
	cleanup = func() { _ = os.RemoveAll(dir) }
	pdfPath := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(pdfPath, pdfPayload(raw), 0o600); err != nil {
		cleanup()
		return nil, nil, err
	}
	prefix := filepath.Join(dir, "page")
	args := []string{"-png", "-r", dpi, "-l", strconv.Itoa(lastPage), pdfPath, prefix}
	if _, err := runCommand(ctx, "pdftoppm", args...); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("could not rasterize the PDF: %w", err)
	}
	matches, err := filepath.Glob(prefix + "-*.png")
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	sortPageFiles(matches)
	return matches, cleanup, nil
}

func tesseractPage(ctx context.Context, imagePath string) (string, error) {
	out, err := runCommand(ctx, "tesseract", imagePath, "stdout", "-l", "pol", "--psm", "6")
	if err != nil {
		if strings.Contains(err.Error(), "traineddata") || strings.Contains(err.Error(), "Failed loading language") {
			return "", errMissingPol()
		}
		return "", fmt.Errorf("could not OCR the PDF: %w", err)
	}
	return string(out), nil
}

func firstPagePNG(raw []byte) ([]byte, error) {
	if _, err := lookPath("pdftoppm"); err != nil {
		return nil, errNeedDockerOCR()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pages, cleanup, err := rasterizePDF(ctx, raw, previewDPI, 1)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if len(pages) == 0 {
		return nil, fmt.Errorf("could not rasterize the PDF")
	}
	return os.ReadFile(pages[0])
}

func sortPageFiles(files []string) {
	sort.Slice(files, func(i, j int) bool {
		return pageIndex(files[i]) < pageIndex(files[j])
	})
}

func pageIndex(path string) int {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	i := strings.LastIndex(base, "-")
	if i < 0 {
		return 0
	}
	n, err := strconv.Atoi(base[i+1:])
	if err != nil {
		return 0
	}
	return n
}
