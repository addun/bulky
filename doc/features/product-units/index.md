# Extra units

A product has one **purchase unit** — that is how you log a buy, and how a bill counts packs. Lists, history, and prices show that unit only.

You can also add extra units with a conversion so a bill that printed another unit still matches. Example: water logged as `szt` (bottles), with `1 szt = 1.5 l`. Six bottles at 15 zł show **2,50 zł / szt**. If the till says `2 × 1.5 l`, Bulkly stores `2 × 1 szt`.

The factor is fixed on the product. A 0.5 l bottle and a 1.5 l bottle of the same water are different products, because each bottle is a different amount of liquid.

Purchases always stay in the purchase unit. Extra units are for reading a bill and for changing the purchase unit; they are not shown on the product list or history.

## Change the purchase unit

If the purchase unit is wrong, add the unit you want as an extra conversion, then **Change unit** and pick that extra. Only extras on the product are allowed. Logged quantities and pack sizes are multiplied by that extra's factor; remaining extras are rebuilt around the new unit.

The previous purchase unit is always kept as an extra so a till that still prints it can match — for `szt` → `l` at 1.5 that keeps `1 l = 2/3 szt`.

See also [Merge products](../product-merge/index.md) (extras move with the product; the same extra unit with two different factors cannot merge) and [Reading bills](../ocr/index.md).
