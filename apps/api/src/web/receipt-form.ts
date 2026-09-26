import { Decimal } from 'decimal.js';
import { boughtOnDate, boughtOnTime, combineBoughtOn, fromDatetimeLocal, nowBoughtOn } from '../domain/bought-on.js';
import { fold, matchProduct, type Label } from '../domain/match.js';
import { type ProductAlias } from '#app/store/aliases';
import { storeAddressLine, type Store } from '#app/store/locations';
import { type ProductListItem } from '#app/store/products';
import { type ReceiptPurchase } from '#app/store/purchases';
import { RECEIPT_MIGRATED, type BillImport, type BillLineInput, type Receipt } from '#app/store/receipts';
import { type UnitDefaults } from '#app/store/units';
import { parse as parseBill, stripStreetPrefix } from '../ocr/parse.js';
import { emptyBill, productLines, type Bill, type Line, marshalBill } from '../ocr/types.js';

export type ReceiptView = {
  receiptId: number;
  imagePath: string;
  status: string;
  boughtOn: string;
  boughtAt: string;
  notes: string;
  storeId: number;
  storeName: string;
  externalId: string;
  streetName: string;
  buildingNumber: string;
  apartmentNumber: string;
  postalCode: string;
  city: string;
  lines: ReceiptLineView[];
  migrated: boolean;
  addressLine: string;
  createStoreUrl: string;
};

export type ReceiptLineView = {
  include: boolean;
  productId: number;
  productName: string;
  unitId: number;
  quantity: string;
  amount: string;
  receiptName: string;
  vatType: string;
  unitPrice: string;
  discount: string;
  ean: string;
};

export function hydrateBill(
  bill: Bill,
  products: ProductListItem[],
  aliases: ProductAlias[],
  chainID: number | null,
  pieceUnitID: number | null,
  weightUnitID: number | null,
): Bill {
  const productByID = new Map<number, ProductListItem>();
  const names: Label[] = [];
  for (const p of products) {
    productByID.set(p.id, p);
    names.push({ productID: p.id, text: p.name });
  }
  const shop: Label[] = [];
  const chain: Label[] = [];
  const global: Label[] = [];
  for (const a of aliases) {
    const lab: Label = { productID: a.productId, text: a.alias };
    if (a.storeId) {
      if (a.storeId === bill.storeId) shop.push(lab);
    } else if (a.retailChainId) {
      if (chainID && a.retailChainId === chainID) chain.push(lab);
    } else {
      global.push(lab);
    }
  }
  for (let i = 0; i < bill.lines.length; i++) {
    let line = { ...bill.lines[i]! };
    if (line.productId !== 0) {
      const p = productByID.get(line.productId);
      if (p) {
        line.productId = p.id;
        if (line.productName === '') line.productName = p.name;
        line.unitId = 0;
      } else {
        line.productId = 0;
      }
    }
    if (line.productId === 0) {
      const matched = matchLineProduct(line.receiptName, line.productName, shop, chain, global, names, productByID);
      if (matched) {
        line.productId = matched.id;
        line.unitId = 0;
      }
    }
    if (line.productId === 0) {
      line.unitId = newProductUnitID(line, pieceUnitID, weightUnitID);
    }
    bill.lines[i] = line;
  }
  return bill;
}

export function billToImport(bill: Bill): BillImport {
  const boughtOn = combineBoughtOn(bill.boughtOn, bill.boughtAt);
  const storeId = bill.storeId > 0 ? bill.storeId : null;
  const inn: BillImport = {
    boughtOn,
    storeId,
    store: storeId ? null : storeFromBill(bill),
    receiptId: null,
    lines: [],
  };
  for (const line of productLines(bill)) {
    const name = (line.productName || line.receiptName).trim();
    inn.lines.push({
      quantity: parseDecimal(line.quantity, 8, false),
      amount: parseDecimal(line.amount, 2, true),
      receiptName: line.receiptName,
      productId: line.productId > 0 ? line.productId : 0,
      productName: name,
      unitId: line.unitId,
      ean: line.ean,
    });
  }
  return inn;
}

function storeFromBill(bill: Bill): Store | null {
  const name = bill.storeName.trim();
  if (name === '' && bill.externalId.trim() === '' && bill.city.trim() === '' && bill.streetName.trim() === '') {
    return null;
  }
  return {
    id: 0,
    name: name || 'Biedronka',
    streetName: bill.streetName,
    buildingNumber: bill.buildingNumber,
    apartmentNumber: bill.apartmentNumber,
    postalCode: bill.postalCode,
    city: bill.city,
    externalId: bill.externalId,
    lat: null,
    lng: null,
    retailChainId: null,
    retailChainName: '',
    purchaseCount: 0,
  };
}

function matchLineProduct(
  receiptName: string,
  productName: string,
  shop: Label[],
  chain: Label[],
  global: Label[],
  names: Label[],
  products: Map<number, ProductListItem>,
): ProductListItem | null {
  for (const q of [receiptName, productName]) {
    const { id, ok } = matchProduct(q, shop, chain, global, names);
    if (!ok) continue;
    const p = products.get(id);
    if (p) return p;
  }
  return null;
}

export function billToView(bill: Bill, receiptID: number, imagePath: string, status: string): ReceiptView {
  const view = baseView(receiptID, imagePath, status);
  view.boughtOn = bill.boughtOn;
  view.boughtAt = bill.boughtAt;
  view.notes = bill.notes;
  view.storeId = bill.storeId;
  view.storeName = bill.storeName;
  view.externalId = bill.externalId;
  view.streetName = bill.streetName;
  view.buildingNumber = bill.buildingNumber;
  view.apartmentNumber = bill.apartmentNumber;
  view.postalCode = bill.postalCode;
  view.city = bill.city;
  for (const line of productLines(bill)) {
    let name = line.productName;
    if (name === '') name = line.receiptName;
    view.lines.push({
      include: true,
      productId: line.productId,
      productName: name,
      unitId: line.unitId,
      quantity: lineQuantity(line),
      amount: line.amount,
      receiptName: line.receiptName,
      vatType: line.vatType,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ean: line.ean,
    });
  }
  return decorateView(view);
}

export function receiptToView(
  r: Receipt,
  products: ProductListItem[],
  stores: Store[],
  aliases: ProductAlias[],
  defaults: UnitDefaults,
): ReceiptView {
  let bill = emptyBill();
  if (r.rawResponse.trim() !== '') {
    bill = parseBill(r.rawResponse);
    if (bill.storeId === 0) bill.storeId = matchStore(bill, stores);
    bill = hydrateBill(bill, products, aliases, storeChainID(bill.storeId, stores), defaults.pieceId, defaults.weightId);
  }
  const view = billToView(bill, r.id, r.imagePath ?? '', r.status);
  view.storeId = knownStoreID(view.storeId, stores);
  const combined = combineBoughtOn(view.boughtOn, view.boughtAt);
  if (combined !== '') view.boughtOn = combined;
  else if (view.boughtOn === '' && view.boughtAt === '') view.boughtOn = nowBoughtOn();
  else view.boughtOn = '';
  view.boughtAt = boughtOnTime(view.boughtOn);
  return decorateView(view);
}

export function viewToRawJSON(view: ReceiptView): string {
  const bill = emptyBill();
  bill.boughtOn = boughtOnDate(view.boughtOn);
  bill.boughtAt = boughtOnTime(view.boughtOn);
  bill.notes = view.notes;
  bill.storeId = view.storeId;
  bill.storeName = view.storeName;
  bill.externalId = view.externalId;
  bill.streetName = view.streetName;
  bill.buildingNumber = view.buildingNumber;
  bill.apartmentNumber = view.apartmentNumber;
  bill.postalCode = view.postalCode;
  bill.city = view.city;
  for (const line of view.lines) {
    bill.lines.push({
      receiptName: line.receiptName,
      productName: line.productName,
      productId: line.productId,
      unitId: line.unitId,
      unitName: '',
      vatType: line.vatType,
      packageCount: '',
      packageSize: '',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      amount: line.amount,
      skip: !line.include,
      skipReason: '',
      ean: line.ean,
    });
  }
  return marshalBill(bill);
}

export function parseReceiptForm(
  get: (name: string) => string,
  _products: ProductListItem[],
): { inn: BillImport; view: ReceiptView; msg: string } {
  const view = parseReceiptView(get);
  const boughtOn = fromDatetimeLocal(view.boughtOn);
  if (boughtOn === '') {
    return { inn: emptyImport(), view, msg: 'Date must be a valid day.' };
  }
  view.boughtOn = boughtOn;
  view.boughtAt = boughtOnTime(boughtOn);

  const inn: BillImport = { boughtOn: boughtOn, storeId: view.storeId || null, store: null, receiptId: null, lines: [] };
  for (let i = 0; i < view.lines.length; i++) {
    const line = view.lines[i]!;
    if (!line.include) continue;
    let qty: Decimal;
    try {
      qty = parseDecimal(line.quantity, 8, false);
    } catch (err) {
      return { inn: emptyImport(), view, msg: `Line ${i + 1}: quantity ${(err as Error).message}.` };
    }
    let amount: Decimal;
    try {
      amount = parseDecimal(line.amount, 2, true);
    } catch (err) {
      return { inn: emptyImport(), view, msg: `Line ${i + 1}: amount ${(err as Error).message}.` };
    }
    const item: BillLineInput = {
      quantity: qty,
      amount: amount,
      receiptName: line.receiptName,
      productId: 0,
      productName: '',
      unitId: 0,
      ean: line.ean,
    };
    if (line.productId > 0) {
      item.productId = line.productId;
    } else {
      if (line.productName === '') {
        return { inn: emptyImport(), view, msg: `Line ${i + 1}: name is required for a new product.` };
      }
      if (line.unitId <= 0) {
        return { inn: emptyImport(), view, msg: `Line ${i + 1}: choose a unit for the new product.` };
      }
      item.productName = line.productName;
      item.unitId = line.unitId;
    }
    inn.lines.push(item);
  }
  if (inn.lines.length === 0) {
    return { inn: emptyImport(), view, msg: 'Tick at least one product.' };
  }
  return { inn, view, msg: '' };
}

function parseReceiptView(get: (name: string) => string): ReceiptView {
  const view = baseView(formInt(get('receipt_id')), get('image_path').trim(), '');
  view.boughtOn = get('bought_on').trim();
  view.boughtAt = '';
  view.notes = get('notes').trim();
  view.storeId = formInt(get('store_id'));
  view.storeName = get('store_name').trim();
  view.externalId = get('external_id').trim();
  view.streetName = get('street_name').trim();
  view.buildingNumber = get('building_number').trim();
  view.apartmentNumber = get('apartment_number').trim();
  view.postalCode = get('postal_code').trim();
  view.city = get('city').trim();
  let n = Number.parseInt(get('line_count').trim(), 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 200) n = 200;
  for (let i = 0; i < n; i++) {
    const p = String(i);
    const choice = get('product_choice_' + p).trim();
    let productID = 0;
    if (choice !== '' && choice !== 'new') {
      const parsed = Number.parseInt(choice, 10);
      if (Number.isFinite(parsed)) productID = parsed;
    }
    view.lines.push({
      include: get('include_' + p) === '1',
      productId: productID,
      productName: get('product_name_' + p).trim(),
      unitId: formInt(get('unit_id_' + p)),
      quantity: get('quantity_' + p).trim(),
      amount: get('amount_' + p).trim(),
      receiptName: get('receipt_name_' + p).trim(),
      vatType: get('vat_type_' + p).trim(),
      unitPrice: get('unit_price_' + p).trim(),
      discount: get('discount_' + p).trim(),
      ean: get('ean_' + p).trim(),
    });
  }
  return decorateView(view);
}

function formInt(s: string): number {
  const v = Number.parseInt(s.trim(), 10);
  return Number.isFinite(v) ? v : 0;
}

export function knownStoreID(id: number, stores: Store[]): number {
  if (id <= 0) return 0;
  for (const c of stores) {
    if (c.id === id) return id;
  }
  return 0;
}

export function storeChainID(storeID: number, stores: Store[]): number | null {
  if (storeID <= 0) return null;
  for (const c of stores) {
    if (c.id === storeID) return c.retailChainId;
  }
  return null;
}

export function matchStore(bill: Bill, stores: Store[]): number {
  const byExt = matchStoreExternalID(bill, stores);
  if (byExt > 0) return byExt;
  const byAddr = matchStoreAddress(bill, stores);
  if (byAddr > 0) return byAddr;
  return matchStoreName(bill, stores);
}

function matchStoreExternalID(bill: Bill, stores: Store[]): number {
  const want = bill.externalId.trim();
  if (want === '') return 0;
  let hit = 0;
  for (const c of stores) {
    if (c.externalId === '' || c.externalId.toLowerCase() !== want.toLowerCase()) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function matchStoreAddress(bill: Bill, stores: Store[]): number {
  const want = storeAddrKey(bill.streetName, bill.buildingNumber, bill.postalCode, bill.city);
  if (want === '') return 0;
  let hit = 0;
  for (const c of stores) {
    if (storeAddrKey(c.streetName, c.buildingNumber, c.postalCode, c.city) !== want) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function matchStoreName(bill: Bill, stores: Store[]): number {
  const name = fold(bill.storeName);
  if (name === '') return 0;
  const city = fold(bill.city);
  let hit = 0;
  for (const c of stores) {
    if (fold(c.name) !== name) continue;
    if (city !== '' && fold(c.city) !== city) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function storeAddrKey(street: string, building: string, postal: string, city: string): string {
  street = fold(stripStreetPrefix(street));
  building = fold(building);
  postal = digitsOnly(postal);
  city = fold(city);
  if (street === '' || building === '' || postal === '' || city === '') return '';
  return street + '\x1f' + building + '\x1f' + postal + '\x1f' + city;
}

function digitsOnly(s: string): string {
  let b = '';
  for (const r of s) {
    if (r >= '0' && r <= '9') b += r;
  }
  return b;
}

export function receiptVisitFacts(
  r: Receipt,
  buys: ReceiptPurchase[],
  stores: Store[],
): { boughtOn: string; notes: string; store: Store } {
  let bill = emptyBill();
  if (r.rawResponse.trim() !== '') {
    try {
      bill = parseBill(r.rawResponse);
    } catch {
      /* ignore */
    }
  }
  const notes = bill.notes;
  if (buys.length > 0) {
    return { boughtOn: buys[0]!.boughtOn, notes, store: storeByID(stores, buys[0]!.storeId) };
  }
  return { boughtOn: combineBoughtOn(bill.boughtOn, bill.boughtAt), notes, store: storeByID(stores, bill.storeId) };
}

export function storeByID(stores: Store[], id: number | null): Store {
  if (!id) return emptyStore();
  for (const c of stores) {
    if (c.id === id) return c;
  }
  return emptyStore();
}

function emptyStore(): Store {
  return {
    id: 0,
    name: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    externalId: '',
    lat: null,
    lng: null,
    retailChainId: null,
    retailChainName: '',
    purchaseCount: 0,
  };
}

function lineQuantity(line: Line): string {
  const q = line.quantity.trim();
  if (q !== '') return q;
  return line.packageCount.trim();
}

function newProductUnitID(line: Line, pieceUnitID: number | null, weightUnitID: number | null): number {
  const qty = lineQuantity(line);
  if (qty === '') return 0;
  if (scaleQty(qty)) return weightUnitID ?? 0;
  return pieceUnitID ?? 0;
}

function scaleQty(s: string): boolean {
  s = s.trim().replaceAll(',', '.');
  const i = s.indexOf('.');
  if (i < 0) return false;
  const frac = s.slice(i + 1);
  if (frac.length < 3) return false;
  return frac.replace(/0+$/, '') !== '';
}

export function parseDecimal(raw: string, maxFrac: number, allowZero: boolean): Decimal {
  raw = raw.trim().replaceAll('\u00a0', '').replaceAll(' ', '').replaceAll(',', '.');
  if (raw === '') throw new Error('required');
  if ((raw.match(/\./g) ?? []).length > 1) throw new Error('invalid number');
  const i = raw.indexOf('.');
  if (i >= 0 && raw.length - i - 1 > maxFrac) throw new Error(`at most ${maxFrac} decimal places`);
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch {
    throw new Error('invalid number');
  }
  if (d.isNegative()) throw new Error('must not be negative');
  if (d.isZero() && !allowZero) throw new Error('must be greater than zero');
  return d;
}

function prefillQuery(field: string): string {
  return 'prefill[' + field + ']';
}

function addressLine(v: ReceiptView): string {
  const addr = storeAddressLine({
    id: 0,
    name: '',
    streetName: v.streetName,
    buildingNumber: v.buildingNumber,
    apartmentNumber: v.apartmentNumber,
    postalCode: v.postalCode,
    city: v.city,
    externalId: '',
    lat: null,
    lng: null,
    retailChainId: null,
    retailChainName: '',
    purchaseCount: 0,
  });
  if (v.storeName === '') return addr;
  if (addr === '') return v.storeName;
  return v.storeName + ' — ' + addr;
}

function createStoreURL(v: ReceiptView): string {
  if (v.status === RECEIPT_MIGRATED || v.storeId !== 0 || v.receiptId <= 0) return '';
  if (v.storeName.trim() === '' && v.streetName.trim() === '' && v.city.trim() === '' && v.externalId.trim() === '') {
    return '';
  }
  const q = new URLSearchParams();
  const set = (key: string, val: string) => {
    const s = val.trim();
    if (s !== '') q.set(prefillQuery(key), s);
  };
  set('name', v.storeName);
  set('external_id', v.externalId);
  set('street_name', v.streetName);
  set('building_number', v.buildingNumber);
  set('apartment_number', v.apartmentNumber);
  set('postal_code', v.postalCode);
  set('city', v.city);
  q.set('next', '/admin/receipts/' + String(v.receiptId));
  return '/admin/stores/new?' + q.toString();
}

function baseView(receiptID: number, imagePath: string, status: string): ReceiptView {
  return {
    receiptId: receiptID,
    imagePath: imagePath,
    status: status,
    boughtOn: '',
    boughtAt: '',
    notes: '',
    storeId: 0,
    storeName: '',
    externalId: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    lines: [],
    migrated: false,
    addressLine: '',
    createStoreUrl: '',
  };
}

export function decorateReceiptView(view: ReceiptView): ReceiptView {
  return decorateView(view);
}

function decorateView(view: ReceiptView): ReceiptView {
  view.migrated = view.status === RECEIPT_MIGRATED;
  view.addressLine = addressLine(view);
  view.createStoreUrl = createStoreURL(view);
  return view;
}

function emptyImport(): BillImport {
  return { storeId: null, store: null, receiptId: null, boughtOn: '', lines: [] };
}
