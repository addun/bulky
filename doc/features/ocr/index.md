# Reading bills

Bulkly can photograph a receipt or upload a PDF and turn the printed lines into purchases. You always check the list before anything is saved.

## Setup

The reader needs a model for photos and for PDF text. Set `OCR_API_KEY` (or `OPENAI_API_KEY`) for OpenAI, or `OCR_BASE_URL` for any OpenAI-compatible API, including a local server. Set the model name on **Admin** (`/admin`); there is no default. Until the key (or base URL) and the model are set, **Receipts** explains that the reader is off.

Scanned PDFs (no selectable text) are read with Tesseract (`pol`). Docker already has that. For `go run` on a Mac, install `tesseract`, `tesseract-lang` (Polish data), and `poppler`. If Tesseract is present without `pol`, the app tells you to run `brew install tesseract-lang` or use Docker.

## Upload

Open **Receipts**, take a photo or choose a file (jpeg, png, webp, gif, or pdf, up to 10 MB), and choose **Read the bill**. Photos go to the model saved under **Admin**: the file is stored, tall receipts are split into overlapping slices (about 1417×2500 px) and sent together in one request. A PDF with selectable text is read in Go and sent as text to the same model. A scanned PDF is rasterized (`pdftoppm`) and OCRed with Tesseract (`-l pol`), then that text goes to the same model. That does not yet create purchases. The stored preview is a JPEG: photos as uploaded, PDFs as every page stacked (up to 40) when `pdftoppm` is available, otherwise a text slip.

The list shows each scan as pending, to confirm, failed, or saved. Failed and pending scans have no product list — photograph or upload the bill again.

The reader is for a receipt, invoice, or till bill. A photo that is not a bill, or one where no product lines can be read, is rejected. Cropped, blurry, or unreadable totals may still produce a list, with a warning on the confirm screen.

## What is read

The model copies what is printed:

- the sale date
- each goods line: the till name, a cleaned name, how many packs, the size of one pack, the unit (kg, g, l, szt, and so on), and the **final** line total after promotions

It does not read the shop, company, or address. Your catalog is not sent to the model. VAT lines, NIP, payment method, change, fiscal footer, and similar non-goods are dropped.

Polish tills often print a shelf price, a promo on the next row, then the amount actually paid. The reader uses that last figure, not the pre-promo price.

Quantity in the log is packs × pack size. A weighed loose buy (`Marchew  1.450 x 4,99` per kg) is 1.450 packs of size 1 kg — the scale weight is packs, not pack size. If a printed name includes a size (`Mąka 1kg`) and the qty column is 2, that is two 1 kg packs. The same till line scanned several times (five milks at 3,29) is stored as one line with packs and amount summed.

## Confirm

Open a scan that is **To confirm**. Check the date, pick a company if you want one, and go through every line: include it or not, keep **New product** or choose an existing one, and fix name, unit, packs, pack size, and amount.

How printed names are matched to your catalog, and how a new product remembers the till wording, is in [Receipt matching](../receipt-matching/index.md). Aliases themselves are in [Product aliases](../product-aliases/index.md).

**Save purchases** writes the included lines as purchases and marks the receipt saved. You can still open it later to see the photo and the list; it will not be imported again.
