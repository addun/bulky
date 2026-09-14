import Decimal from 'decimal.js';
import { boughtOnDate, boughtOnTime, joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { fold, matchProduct, type Label } from '../domain/match';
import { type ProductAlias } from '@app/store/aliases';
import { storyAddressLine, type Story } from '@app/store/locations';
import { type ProductListItem } from '@app/store/products';
import { type ReceiptPurchase } from '@app/store/purchases';
import { RECEIPT_MIGRATED, type BillImport, type BillLineInput, type Receipt } from '@app/store/receipts';
import { type UnitDefaults } from '@app/store/units';
import { parse as parseBill, stripStreetPrefix } from '../ocr/parse';
import { emptyBill, productLines, type Bill, type Line, marshalBill } from '../ocr/types';

export type ReceiptView = {
  receiptId: number;
  imagePath: string;
  status: string;
  boughtOn: string;
  boughtAt: string;
  notes: string;
  storyId: number;
  storyName: string;
  externalId: string;
  streetName: string;
  buildingNumber: string;
  apartmentNumber: string;
  postalCode: string;
  city: string;
  lines: ReceiptLineView[];
  migrated: boolean;
  addressLine: string;
  createStoryUrl: string;
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
    if (a.storyId) {
      if (a.storyId === bill.storyId) shop.push(lab);
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
  view.storyId = bill.storyId;
  view.storyName = bill.storyName;
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
    });
  }
  return decorateView(view);
}

export function receiptToView(
  r: Receipt,
  products: ProductListItem[],
  stories: Story[],
  aliases: ProductAlias[],
  defaults: UnitDefaults,
): ReceiptView {
  let bill = emptyBill();
  if (r.rawResponse.trim() !== '') {
    bill = parseBill(r.rawResponse);
    if (bill.storyId === 0) bill.storyId = matchStory(bill, stories);
    bill = hydrateBill(bill, products, aliases, storyChainID(bill.storyId, stories), defaults.pieceId, defaults.weightId);
  }
  const view = billToView(bill, r.id, r.imagePath, r.status);
  view.storyId = knownStoryID(view.storyId, stories);
  if (view.boughtOn === '') {
    const now = new Date();
    view.boughtOn = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    view.boughtAt = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  }
  return decorateView(view);
}

export function viewToRawJSON(view: ReceiptView): string {
  const bill = emptyBill();
  bill.boughtOn = view.boughtOn;
  bill.boughtAt = view.boughtAt;
  bill.notes = view.notes;
  bill.storyId = view.storyId;
  bill.storyName = view.storyName;
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
    });
  }
  return marshalBill(bill);
}

export function parseReceiptForm(
  get: (name: string) => string,
  _products: ProductListItem[],
): { inn: BillImport; view: ReceiptView; msg: string } {
  const view = parseReceiptView(get);
  let boughtOn: string;
  try {
    boughtOn = normalizeBoughtOn(joinBoughtOn(view.boughtOn, view.boughtAt));
  } catch {
    return { inn: emptyImport(), view, msg: 'Date must be a valid day.' };
  }
  view.boughtOn = boughtOnDate(boughtOn);
  view.boughtAt = boughtOnTime(boughtOn);

  const inn: BillImport = { boughtOn: boughtOn, storyId: view.storyId || null, story: null, receiptId: null, lines: [] };
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
    const item: BillLineInput = { quantity: qty, amount: amount, receiptName: line.receiptName, productId: 0, productName: '', unitId: 0 };
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
  view.boughtAt = get('bought_at').trim();
  view.notes = get('notes').trim();
  view.storyId = formInt(get('story_id'));
  view.storyName = get('story_name').trim();
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
    });
  }
  return decorateView(view);
}

function formInt(s: string): number {
  const v = Number.parseInt(s.trim(), 10);
  return Number.isFinite(v) ? v : 0;
}

export function knownStoryID(id: number, stories: Story[]): number {
  if (id <= 0) return 0;
  for (const c of stories) {
    if (c.id === id) return id;
  }
  return 0;
}

export function storyChainID(storyID: number, stories: Story[]): number | null {
  if (storyID <= 0) return null;
  for (const c of stories) {
    if (c.id === storyID) return c.retailChainId;
  }
  return null;
}

export function matchStory(bill: Bill, stories: Story[]): number {
  const byExt = matchStoryExternalID(bill, stories);
  if (byExt > 0) return byExt;
  const byAddr = matchStoryAddress(bill, stories);
  if (byAddr > 0) return byAddr;
  return matchStoryName(bill, stories);
}

function matchStoryExternalID(bill: Bill, stories: Story[]): number {
  const want = bill.externalId.trim();
  if (want === '') return 0;
  let hit = 0;
  for (const c of stories) {
    if (c.externalId === '' || c.externalId.toLowerCase() !== want.toLowerCase()) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function matchStoryAddress(bill: Bill, stories: Story[]): number {
  const want = storyAddrKey(bill.streetName, bill.buildingNumber, bill.postalCode, bill.city);
  if (want === '') return 0;
  let hit = 0;
  for (const c of stories) {
    if (storyAddrKey(c.streetName, c.buildingNumber, c.postalCode, c.city) !== want) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function matchStoryName(bill: Bill, stories: Story[]): number {
  const name = fold(bill.storyName);
  if (name === '') return 0;
  const city = fold(bill.city);
  let hit = 0;
  for (const c of stories) {
    if (fold(c.name) !== name) continue;
    if (city !== '' && fold(c.city) !== city) continue;
    if (hit !== 0 && hit !== c.id) return 0;
    hit = c.id;
  }
  return hit;
}

function storyAddrKey(street: string, building: string, postal: string, city: string): string {
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
  stories: Story[],
): { boughtOn: string; boughtAt: string; notes: string; story: Story } {
  let bill = emptyBill();
  if (r.rawResponse.trim() !== '') {
    try {
      bill = parseBill(r.rawResponse);
    } catch {
      /* ignore */
    }
  }
  const notes = bill.notes;
  const boughtAt = bill.boughtAt;
  if (buys.length > 0) {
    return { boughtOn: buys[0]!.boughtOn, boughtAt, notes, story: storyByID(stories, buys[0]!.storyId) };
  }
  return { boughtOn: bill.boughtOn, boughtAt, notes, story: storyByID(stories, bill.storyId) };
}

export function storyByID(stories: Story[], id: number | null): Story {
  if (!id) return emptyStory();
  for (const c of stories) {
    if (c.id === id) return c;
  }
  return emptyStory();
}

function emptyStory(): Story {
  return {
    id: 0,
    name: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    externalId: '',
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
  const addr = storyAddressLine({
    id: 0,
    name: '',
    streetName: v.streetName,
    buildingNumber: v.buildingNumber,
    apartmentNumber: v.apartmentNumber,
    postalCode: v.postalCode,
    city: v.city,
    externalId: '',
    retailChainId: null,
    retailChainName: '',
    purchaseCount: 0,
  });
  if (v.storyName === '') return addr;
  if (addr === '') return v.storyName;
  return v.storyName + ' — ' + addr;
}

function createStoryURL(v: ReceiptView): string {
  if (v.status === RECEIPT_MIGRATED || v.storyId !== 0 || v.receiptId <= 0) return '';
  if (v.storyName.trim() === '' && v.streetName.trim() === '' && v.city.trim() === '' && v.externalId.trim() === '') {
    return '';
  }
  const q = new URLSearchParams();
  const set = (key: string, val: string) => {
    const s = val.trim();
    if (s !== '') q.set(prefillQuery(key), s);
  };
  set('name', v.storyName);
  set('external_id', v.externalId);
  set('street_name', v.streetName);
  set('building_number', v.buildingNumber);
  set('apartment_number', v.apartmentNumber);
  set('postal_code', v.postalCode);
  set('city', v.city);
  q.set('next', '/admin/receipts/' + String(v.receiptId));
  return '/admin/stories/new?' + q.toString();
}

function baseView(receiptID: number, imagePath: string, status: string): ReceiptView {
  return {
    receiptId: receiptID,
    imagePath: imagePath,
    status: status,
    boughtOn: '',
    boughtAt: '',
    notes: '',
    storyId: 0,
    storyName: '',
    externalId: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    lines: [],
    migrated: false,
    addressLine: '',
    createStoryUrl: '',
  };
}

export function decorateReceiptView(view: ReceiptView): ReceiptView {
  return decorateView(view);
}

function decorateView(view: ReceiptView): ReceiptView {
  view.migrated = view.status === RECEIPT_MIGRATED;
  view.addressLine = addressLine(view);
  view.createStoryUrl = createStoryURL(view);
  return view;
}

function emptyImport(): BillImport {
  return { storyId: null, story: null, receiptId: null, boughtOn: '', lines: [] };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
