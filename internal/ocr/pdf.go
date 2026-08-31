package ocr

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/disintegration/imaging"
	"github.com/ledongthuc/pdf"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

const (
	minPDFLetters   = 40
	maxPDFPages     = 40
	maxPDFTextRunes = 80_000
	previewPageGap  = 12
	previewMaxW     = 1200
)

var previewGapColor = color.RGBA{R: 216, G: 222, B: 230, A: 255}

func extractPDFText(raw []byte) (text string, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			text = ""
			err = nil
		}
	}()
	raw = pdfPayload(raw)
	r, err := pdf.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return "", nil
	}
	n := r.NumPage()
	if n > maxPDFPages {
		n = maxPDFPages
	}
	var b strings.Builder
	for i := 1; i <= n; i++ {
		page := pageText(r.Page(i))
		if page == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(page)
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		rd, plainErr := r.GetPlainText()
		if plainErr == nil && rd != nil {
			var buf bytes.Buffer
			_, _ = io.Copy(&buf, rd)
			out = strings.TrimSpace(buf.String())
		}
	}
	if utf8.RuneCountInString(out) > maxPDFTextRunes {
		out = string([]rune(out)[:maxPDFTextRunes])
	}
	return out, nil
}

func pageText(p pdf.Page) string {
	if p.V.IsNull() {
		return ""
	}
	rows, err := p.GetTextByRow()
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, row := range rows {
		var parts []string
		for _, word := range row.Content {
			s := strings.TrimSpace(word.S)
			if s != "" {
				parts = append(parts, s)
			}
		}
		if len(parts) == 0 {
			continue
		}
		b.WriteString(strings.Join(parts, " "))
		b.WriteByte('\n')
	}
	return strings.TrimSpace(b.String())
}

func isPDFWithText(text string) bool {
	n := 0
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			n++
			if n >= minPDFLetters {
				return true
			}
		}
	}
	return false
}

func pdfPayload(raw []byte) []byte {
	i := bytes.Index(raw, []byte("%PDF-"))
	if i <= 0 {
		return raw
	}
	return raw[i:]
}

func previewPDF(raw []byte) ([]byte, error) {
	if jpeg, err := previewPDFPages(raw); err == nil && len(jpeg) > 0 {
		return jpeg, nil
	}
	text, _ := extractPDFText(raw)
	return renderTextSlip(text)
}

func previewPDFPages(raw []byte) ([]byte, error) {
	pngs, err := previewPagePNGs(raw)
	if err != nil {
		return nil, err
	}
	return stackPreviewJPEG(pngs)
}

func stackPreviewJPEG(pngs [][]byte) ([]byte, error) {
	if len(pngs) == 0 {
		return nil, fmt.Errorf("could not rasterize the PDF")
	}
	pages := make([]image.Image, 0, len(pngs))
	for _, raw := range pngs {
		img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
		if err != nil {
			return nil, fmt.Errorf("could not read the PDF page")
		}
		pages = append(pages, fitPreviewPage(flattenWhite(img)))
	}
	return fitJPEG(stackPages(pages), maxPreparedBytes)
}

func fitPreviewPage(img image.Image) image.Image {
	if img.Bounds().Dx() > previewMaxW {
		return imaging.Resize(img, previewMaxW, 0, imaging.Lanczos)
	}
	return img
}

func stackPages(pages []image.Image) image.Image {
	if len(pages) == 0 {
		return imaging.New(1, 1, color.White)
	}
	if len(pages) == 1 {
		return pages[0]
	}
	width := 0
	height := 0
	for i, p := range pages {
		if w := p.Bounds().Dx(); w > width {
			width = w
		}
		height += p.Bounds().Dy()
		if i > 0 {
			height += previewPageGap
		}
	}
	out := imaging.New(width, height, previewGapColor)
	y := 0
	for i, p := range pages {
		x := (width - p.Bounds().Dx()) / 2
		out = imaging.Paste(out, p, image.Pt(x, y))
		y += p.Bounds().Dy()
		if i < len(pages)-1 {
			y += previewPageGap
		}
	}
	return out
}

func renderTextSlip(text string) ([]byte, error) {
	lines := wrapPreviewLines(text)
	face := basicfont.Face7x13
	const (
		pad   = 18
		lineH = 14
		width = 420
	)
	height := pad*2 + lineH*len(lines)
	if height < 220 {
		height = 220
	}
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)
	d := &font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(color.RGBA{R: 16, G: 32, B: 51, A: 255}),
		Face: face,
		Dot:  fixed.P(pad, pad+11),
	}
	for _, line := range lines {
		d.DrawString(line)
		d.Dot.X = fixed.I(pad)
		d.Dot.Y += fixed.I(lineH)
	}
	return encodeJPEG(img)
}

func wrapPreviewLines(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return []string{"PDF bill", "Could not render PDF pages."}
	}
	const (
		maxChars = 52
		maxLines = 72
	)
	var out []string
	out = append(out, "PDF bill")
	out = append(out, "")
	for _, raw := range strings.Split(text, "\n") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			if len(out) > 0 && out[len(out)-1] != "" {
				out = append(out, "")
			}
			continue
		}
		runes := []rune(raw)
		for len(runes) > 0 {
			n := maxChars
			if n > len(runes) {
				n = len(runes)
			}
			out = append(out, string(runes[:n]))
			runes = runes[n:]
			if len(out) >= maxLines {
				return out
			}
		}
		if len(out) >= maxLines {
			return out
		}
	}
	return out
}
