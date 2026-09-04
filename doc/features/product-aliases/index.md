# Product aliases

The same thing often has different names on the shelf and on the bill. Lidl might print “Mąka tortowa 1kg” while you keep the product as Cake flour. An alias is that other name, tied to the product so Bulkly still treats it as one item.

Each alias has one scope:

- **Any shop** — the wording is the same everywhere
- **Retail chain** — every store in that chain (both Biedronka addresses, for example)
- **Store** — one address only, when that till prints something the rest of the chain does not

Matching tries store, then chain, then any-shop, then the catalog name. A Lidl chain alias never applies on a Biedronka bill.

The products page search looks at catalog names and aliases. Close wording still counts there (Polish diacritics, extra spaces, a trailing size, a small typo). Receipt matching does not: till labels are compared exactly.

Add aliases from **Aliases** in the sidebar, or from a product (the Aliases link next to Edit, which lists only that product). Saving a **New product** from a bill also stores the printed till name as an alias; see [Receipt matching](../receipt-matching/index.md). If a bill created a second catalog row for something you already keep, [merge](../product-merge/index.md) the extra row into the product you want to keep.
