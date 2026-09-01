# Extra units

A product has one **purchase unit** — that is how you log a buy, and how a bill counts packs. You can also add extra units with a conversion so the same history shows another price.

Example: water logged as `szt` (bottles), with `1 szt = 1.5 l`. Six bottles at 15 zł show **2,50 zł / szt** and **1,67 zł / l**. You can add more extras the same way (`ml`, and so on).

The factor is fixed on the product. A 0.5 l bottle and a 1.5 l bottle of the same water are different products, because each bottle is a different amount of liquid.

Purchases always stay in the purchase unit. Extra units are for display, and for reading a bill that printed the extra unit: if the till says `2 × 1.5 l` and the product converts `1 szt = 1.5 l`, Bulkly stores `2 × 1 szt`.

See also [Merge products](../product-merge/index.md) (extras move with the product; the same extra unit with two different factors cannot merge) and [Reading bills](../ocr/index.md).
