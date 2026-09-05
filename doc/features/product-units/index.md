# Extra units

A product has one **purchase unit** — that is how you log a buy. Lists, history, and prices show that unit only. Packaged goods are usually `szt` (items). Produce and deli sold on a scale use `kg`.

You can also add extra units with a conversion, for your own notes or for **Change unit**. Example: water logged as `szt`, with `1 szt = 1.5 l`. Six bottles at 15 zł show **2,50 zł / szt**.

The factor is fixed on the product. A 0.5 l bottle and a 1.5 l bottle of the same water are different products — keep the size in the name (`Woda 1.5l`).

Purchases always stay in the purchase unit. Extra units are not shown on the product list or history. Confirming a bill does not convert quantity through extras: the number before `x` on the till is how many you bought.

## Change the purchase unit

If the purchase unit is wrong, add the unit you want as an extra conversion, then **Change unit** and pick that extra. Only extras on the product are allowed. Logged quantities are multiplied by that extra's factor; remaining extras are rebuilt around the new unit.

The previous purchase unit is always kept as an extra — for `szt` → `l` at 1.5 that keeps `1 l = 2/3 szt`.

See also [Merge products](../product-merge/index.md) (extras move with the product; the same extra unit with two different factors cannot merge) and [Reading bills](../ocr/index.md).
