# Receipt matching

A bill photo is only used to read the printed lines: the till name, packs, pack size, amount, and unit. Bulkly does not send your product list to the reader. The rest of photographing and confirming a bill is in [Reading bills](../ocr/index.md).

On the confirm screen, each printed name is compared with catalog names and [product aliases](../product-aliases/index.md). Close wording still counts (abbreviations, Polish diacritics, a trailing size like `1kg`, a small typo). A shop-specific alias wins when the bill already has a company; otherwise a global alias or the catalog name is used.

If nothing is close enough, or two products look equally likely, the line stays as a **New product** so you can pick or name it.

When you save a line as a new product, Bulkly also stores the printed till text as an alias on that product (tied to the company you chose, or global if you chose none). The next bill with the same wording can then match. This does not happen when you map a line onto a product that already existed. The alias is skipped when it is empty, identical to the new catalog name, or already used.
