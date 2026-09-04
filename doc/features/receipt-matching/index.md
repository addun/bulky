# Receipt matching

A bill photo is only used to read the printed lines: the till name, packs, pack size, amount, and unit. Bulkly does not send your product list to the reader. The rest of photographing and confirming a bill is in [Reading bills](../ocr/index.md).

On the confirm screen, each printed name is compared with catalog names and [product aliases](../product-aliases/index.md). The wording must match (case, extra spaces, punctuation, and Polish diacritics do not matter). A shorter name, a trailing size, or a typo does not count. When the bill already has a store, a store alias wins, then a chain alias for that store’s retail chain, then a global alias or the catalog name. A bill with no store yet only uses global aliases and catalog names.

If nothing matches, or two products share the same wording, the line stays as a **New product** so you can pick or name it. If that created a duplicate catalog row, [merge](../product-merge/index.md) it into the product you already keep.

When you save a line as a new product, Bulkly also stores the printed till text as an alias on that product. If the store belongs to a retail chain, the alias is scoped to the chain so the next Biedronka (or Lidl) bill can match. Otherwise it is tied to that store, or global if you chose none. This does not happen when you map a line onto a product that already existed. The alias is skipped when it is empty, identical to the new catalog name, or already used.
