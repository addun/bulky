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
	visionDPI  = "200"
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

var pdfPageJPEGs = func(raw []byte) ([][]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if _, err := lookPath("pdftoppm"); err != nil {
		return nil, errNeedPoppler()
	}
	pages, cleanup, err := rasterizePDF(ctx, raw, visionDPI, maxPDFPages)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if len(pages) == 0 {
		return nil, fmt.Errorf("could not rasterize the PDF")
	}
	out := make([][]byte, 0, len(pages))
	for _, path := range pages {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if len(b) == 0 {
			continue
		}
		jpeg, err := PrepareJPEG(b)
		if err != nil {
			return nil, err
		}
		out = append(out, jpeg)
	}
	if len(out) == 0 {
		return nil, ErrNoPDFText
	}
	return out, nil
}

func errNeedPoppler() error {
	return fmt.Errorf("%w: install poppler or run Bulkly in Docker", ErrNoPDFText)
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

func previewPagePNGs(raw []byte) ([][]byte, error) {
	if _, err := lookPath("pdftoppm"); err != nil {
		return nil, errNeedPoppler()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	paths, cleanup, err := rasterizePDF(ctx, raw, previewDPI, maxPDFPages)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if len(paths) == 0 {
		return nil, fmt.Errorf("could not rasterize the PDF")
	}
	out := make([][]byte, 0, len(paths))
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if len(b) == 0 {
			continue
		}
		out = append(out, b)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("could not rasterize the PDF")
	}
	return out, nil
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
