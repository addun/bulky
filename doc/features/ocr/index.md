# Reading bills

Bulkly can photograph a receipt or upload a PDF and turn the printed lines into purchases. You always check the list before anything is saved.

## Setup

The reader needs a vision model. Set `OCR_API_KEY` (or `OPENAI_API_KEY`) for OpenAI, or `OCR_BASE_URL` for any OpenAI-compatible API, including a local server. Set the model name on **Admin** (`/admin`); there is no default. Until the key (or base URL) and the model are set, **Receipts** explains that the reader is off.

PDFs are rasterized with `pdftoppm` (Poppler) and sent as page images to the same model as photos. Docker already has Poppler. For `go run` on a Mac, `brew install poppler`. There is no Tesseract step: extracted text glued columns together (for example `bananyC1.35x6.00`) and the model could not unstick them.

## Upload

Open **Receipts**, take a photo or choose a file (jpeg, png, webp, gif, or pdf, up to 10 MB), and choose **Read the bill**. Photos go to the model saved under **Admin** as one image (the whole receipt, not sliced). A PDF is rasterized (`pdftoppm`) and each page is sent as a full page image. Upload stores the file and returns you to the receipt while the reader runs in the background. Refresh that page (it also refreshes itself every few seconds) to see whether the scan is still reading, failed, or ready to confirm. That does not yet create purchases. The stored preview is a JPEG: photos as uploaded, PDFs as every page stacked (up to 40) when `pdftoppm` is available, otherwise a text slip.

The list shows each scan as reading, to confirm, failed, or saved. Open a scan to see its status. Failed scans can be sent back to the reader with **Read again**, or you can photograph or upload the bill again.

The reader is for a receipt, invoice, or till bill. A photo that is not a bill, or one where no product lines can be read, is rejected. Cropped, blurry, or unreadable totals may still produce a list, with a warning on the confirm screen.

## What is read

The model copies what is printed. It does not calculate.

- the shop name, its own store number when printed, and address (street, building number, optional apartment, postal code, city)
- the sale date and hour
- each goods line: the till name, a cleaned name, VAT type (A, B, or C), how many packs, the size of one pack, the unit (kg, g, l, szt, and so on), the shelf unit price, any rabat, and the **final** line total when that figure is printed

Your catalog is not sent to the model. VAT summary rows, NIP, payment method, change, fiscal footer, and similar non-goods are dropped.

If a line has a unit price and a rabat but no final paid figure, Bulkly fills the amount after reading: packs × unit price − rabat. Printed totals are left as they are.

Polish tills often print a shelf price, a promo on the next row, then the amount actually paid. The reader copies those columns; it does not subtract the promo itself.

A store in your catalog that matches the printed store number, then the printed address (or a unique shop name) is pre-selected on the confirm screen. If nothing matches, **Create store** opens the store form filled from the till header (`prefill[name]`, `prefill[external_id]`, `prefill[street_name]`, and so on). Saving returns you to the bill; the new shop is selected only if it still matches what was read. You can still pick another.

Quantity in the log is packs × pack size. A weighed loose buy (`Marchew  1.450 x 4,99` per kg) is 1.450 packs of size 1 kg — the scale weight is packs, not pack size. If a printed name includes a size (`Mąka 1kg`) and the qty column is 2, that is two 1 kg packs. The same till line scanned several times (five milks at 3,29) stays as five separate rows.

## Confirm

Open a scan that is **To confirm**. Check the date and hour, pick a store if you want one, and go through every line: include it or not, keep **New product** or choose an existing one, and fix name, unit, packs, pack size, and amount.

How printed names are matched to your catalog, and how a new product remembers the till wording, is in [Receipt matching](../receipt-matching/index.md). Aliases themselves are in [Product aliases](../product-aliases/index.md).

**Save purchases** writes the included lines as purchases (date and hour in `bought_on`, for example `2026-08-18 14:32`) and marks the receipt saved. You can still open it later to see the photo and the list; it will not be imported again.
