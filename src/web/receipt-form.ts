import Decimal from 'decimal.js';
import { boughtOnDate, boughtOnTime, joinBoughtOn, normalizeBoughtOn } from '../domain/bought-on';
import { fold, matchProduct, type Label } from '../domain/match';
import {
  RECEIPT_MIGRATED,
  storyAddressLine,
  type BillImport,
  type BillLineInput,
  type ProductAlias,
  type ProductListItem,
  type Receipt,
  type ReceiptPurchase,
  type Story,
  type UnitDefaults,
} from '../domain/types';
import { parse as parseBill, stripStreetPrefix } from '../ocr/parse';
import { emptyBill, productLines, type Bill, type Line, marshalBill } from '../ocr/types';

export type ReceiptView = {
  ReceiptID: number;
  ImagePath: string;
  Status: string;
  BoughtOn: string;
  BoughtAt: string;
  Notes: string;
  StoryID: number;
  StoryName: string;
  ExternalID: string;
  StreetName: string;
  BuildingNumber: string;
  ApartmentNumber: string;
  PostalCode: string;
  City: string;
  Lines: ReceiptLineView[];
  Migrated: boolean;
  AddressLine: string;
  CreateStoryURL: string;
};

export type ReceiptLineView = {
  Include: boolean;
  ProductID: number;
  ProductName: string;
  UnitID: number;
  Quantity: string;
  Amount: string;
  ReceiptName: string;
  VatType: string;
  UnitPrice: string;
  Discount: string;
};

export function hydrateBill(
  bill: Bill,
  products: ProductListItem[],
  aliases: ProductAlias[],
  chainID: number,
  pieceUnitID: number,
  weightUnitID: number,
): Bill {
  const productByID = new Map<number, ProductListItem>();
  const names: Label[] = [];
  for (const p of products) {
    productByID.set(p.ID, p);
    names.push({ productID: p.ID, text: p.Name });
  }
  const shop: Label[] = [];
  const chain: Label[] = [];
  const global: Label[] = [];
  for (const a of aliases) {
    const lab: Label = { productID: a.ProductID, text: a.Alias };
    if (a.StoryID > 0) {
      if (a.StoryID === bill.StoryID) shop.push(lab);
    } else if (a.RetailChainID > 0) {
      if (chainID > 0 && a.RetailChainID === chainID) chain.push(lab);
    } else {
      global.push(lab);
    }
  }
  for (let i = 0; i < bill.Lines.length; i++) {
    let line = { ...bill.Lines[i]! };
    if (line.ProductID !== 0) {
      const p = productByID.get(line.ProductID);
      if (p) {
        line.ProductID = p.ID;
        if (line.ProductName === '') line.ProductName = p.Name;
        line.UnitID = 0;
      } else {
        line.ProductID = 0;
      }
    }
    if (line.ProductID === 0) {
      const matched = matchLineProduct(line.ReceiptName, line.ProductName, shop, chain, global, names, productByID);
      if (matched) {
        line.ProductID = matched.ID;
        line.UnitID = 0;
      }
    }
    if (line.ProductID === 0) {
      line.UnitID = newProductUnitID(line, pieceUnitID, weightUnitID);
    }
    bill.Lines[i] = line;
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
  view.BoughtOn = bill.BoughtOn;
  view.BoughtAt = bill.BoughtAt;
  view.Notes = bill.Notes;
  view.StoryID = bill.StoryID;
  view.StoryName = bill.StoryName;
  view.ExternalID = bill.ExternalID;
  view.StreetName = bill.StreetName;
  view.BuildingNumber = bill.BuildingNumber;
  view.ApartmentNumber = bill.ApartmentNumber;
  view.PostalCode = bill.PostalCode;
  view.City = bill.City;
  for (const line of productLines(bill)) {
    let name = line.ProductName;
    if (name === '') name = line.ReceiptName;
    view.Lines.push({
      Include: true,
      ProductID: line.ProductID,
      ProductName: name,
      UnitID: line.UnitID,
      Quantity: lineQuantity(line),
      Amount: line.Amount,
      ReceiptName: line.ReceiptName,
      VatType: line.VatType,
      UnitPrice: line.UnitPrice,
      Discount: line.Discount,
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
  if (r.RawResponse.trim() !== '') {
    bill = parseBill(r.RawResponse);
    if (bill.StoryID === 0) bill.StoryID = matchStory(bill, stories);
    bill = hydrateBill(bill, products, aliases, storyChainID(bill.StoryID, stories), defaults.PieceID, defaults.WeightID);
  }
  const view = billToView(bill, r.ID, r.ImagePath, r.Status);
  view.StoryID = knownStoryID(view.StoryID, stories);
  if (view.BoughtOn === '') {
    const now = new Date();
    view.BoughtOn = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    view.BoughtAt = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  }
  return decorateView(view);
}

export function viewToRawJSON(view: ReceiptView): string {
  const bill = emptyBill();
  bill.BoughtOn = view.BoughtOn;
  bill.BoughtAt = view.BoughtAt;
  bill.Notes = view.Notes;
  bill.StoryID = view.StoryID;
  bill.StoryName = view.StoryName;
  bill.ExternalID = view.ExternalID;
  bill.StreetName = view.StreetName;
  bill.BuildingNumber = view.BuildingNumber;
  bill.ApartmentNumber = view.ApartmentNumber;
  bill.PostalCode = view.PostalCode;
  bill.City = view.City;
  for (const line of view.Lines) {
    bill.Lines.push({
      ReceiptName: line.ReceiptName,
      ProductName: line.ProductName,
      ProductID: line.ProductID,
      UnitID: line.UnitID,
      UnitName: '',
      VatType: line.VatType,
      PackageCount: '',
      PackageSize: '',
      Quantity: line.Quantity,
      UnitPrice: line.UnitPrice,
      Discount: line.Discount,
      Amount: line.Amount,
      Skip: !line.Include,
      SkipReason: '',
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
    boughtOn = normalizeBoughtOn(joinBoughtOn(view.BoughtOn, view.BoughtAt));
  } catch {
    return { inn: emptyImport(), view, msg: 'Date must be a valid day.' };
  }
  view.BoughtOn = boughtOnDate(boughtOn);
  view.BoughtAt = boughtOnTime(boughtOn);

  const inn: BillImport = { BoughtOn: boughtOn, StoryID: view.StoryID, Story: null, ReceiptID: 0, Lines: [] };
  for (let i = 0; i < view.Lines.length; i++) {
    const line = view.Lines[i]!;
    if (!line.Include) continue;
    let qty: Decimal;
    try {
      qty = parseDecimal(line.Quantity, 8, false);
    } catch (err) {
      return { inn: emptyImport(), view, msg: `Line ${i + 1}: quantity ${(err as Error).message}.` };
    }
    let amount: Decimal;
    try {
      amount = parseDecimal(line.Amount, 2, true);
    } catch (err) {
      return { inn: emptyImport(), view, msg: `Line ${i + 1}: amount ${(err as Error).message}.` };
    }
    const item: BillLineInput = { Quantity: qty, Amount: amount, ReceiptName: line.ReceiptName, ProductID: 0, ProductName: '', UnitID: 0 };
    if (line.ProductID > 0) {
      item.ProductID = line.ProductID;
    } else {
      if (line.ProductName === '') {
        return { inn: emptyImport(), view, msg: `Line ${i + 1}: name is required for a new product.` };
      }
      if (line.UnitID <= 0) {
        return { inn: emptyImport(), view, msg: `Line ${i + 1}: choose a unit for the new product.` };
      }
      item.ProductName = line.ProductName;
      item.UnitID = line.UnitID;
    }
    inn.Lines.push(item);
  }
  if (inn.Lines.length === 0) {
    return { inn: emptyImport(), view, msg: 'Tick at least one product.' };
  }
  return { inn, view, msg: '' };
}

function parseReceiptView(get: (name: string) => string): ReceiptView {
  const view = baseView(formInt(get('receipt_id')), get('image_path').trim(), '');
  view.BoughtOn = get('bought_on').trim();
  view.BoughtAt = get('bought_at').trim();
  view.Notes = get('notes').trim();
  view.StoryID = formInt(get('story_id'));
  view.StoryName = get('story_name').trim();
  view.ExternalID = get('external_id').trim();
  view.StreetName = get('street_name').trim();
  view.BuildingNumber = get('building_number').trim();
  view.ApartmentNumber = get('apartment_number').trim();
  view.PostalCode = get('postal_code').trim();
  view.City = get('city').trim();
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
    view.Lines.push({
      Include: get('include_' + p) === '1',
      ProductID: productID,
      ProductName: get('product_name_' + p).trim(),
      UnitID: formInt(get('unit_id_' + p)),
      Quantity: get('quantity_' + p).trim(),
      Amount: get('amount_' + p).trim(),
      ReceiptName: get('receipt_name_' + p).trim(),
      VatType: get('vat_type_' + p).trim(),
      UnitPrice: get('unit_price_' + p).trim(),
      Discount: get('discount_' + p).trim(),
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
    if (c.ID === id) return id;
  }
  return 0;
}

export function storyChainID(storyID: number, stories: Story[]): number {
  if (storyID <= 0) return 0;
  for (const c of stories) {
    if (c.ID === storyID) return c.RetailChainID;
  }
  return 0;
}

export function matchStory(bill: Bill, stories: Story[]): number {
  const byExt = matchStoryExternalID(bill, stories);
  if (byExt > 0) return byExt;
  const byAddr = matchStoryAddress(bill, stories);
  if (byAddr > 0) return byAddr;
  return matchStoryName(bill, stories);
}

function matchStoryExternalID(bill: Bill, stories: Story[]): number {
  const want = bill.ExternalID.trim();
  if (want === '') return 0;
  let hit = 0;
  for (const c of stories) {
    if (c.ExternalID === '' || c.ExternalID.toLowerCase() !== want.toLowerCase()) continue;
    if (hit !== 0 && hit !== c.ID) return 0;
    hit = c.ID;
  }
  return hit;
}

function matchStoryAddress(bill: Bill, stories: Story[]): number {
  const want = storyAddrKey(bill.StreetName, bill.BuildingNumber, bill.PostalCode, bill.City);
  if (want === '') return 0;
  let hit = 0;
  for (const c of stories) {
    if (storyAddrKey(c.StreetName, c.BuildingNumber, c.PostalCode, c.City) !== want) continue;
    if (hit !== 0 && hit !== c.ID) return 0;
    hit = c.ID;
  }
  return hit;
}

function matchStoryName(bill: Bill, stories: Story[]): number {
  const name = fold(bill.StoryName);
  if (name === '') return 0;
  const city = fold(bill.City);
  let hit = 0;
  for (const c of stories) {
    if (fold(c.Name) !== name) continue;
    if (city !== '' && fold(c.City) !== city) continue;
    if (hit !== 0 && hit !== c.ID) return 0;
    hit = c.ID;
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
  if (r.RawResponse.trim() !== '') {
    try {
      bill = parseBill(r.RawResponse);
    } catch {
      /* ignore */
    }
  }
  const notes = bill.Notes;
  const boughtAt = bill.BoughtAt;
  if (buys.length > 0) {
    return { boughtOn: buys[0]!.BoughtOn, boughtAt, notes, story: storyByID(stories, buys[0]!.StoryID) };
  }
  return { boughtOn: bill.BoughtOn, boughtAt, notes, story: storyByID(stories, bill.StoryID) };
}

export function storyByID(stories: Story[], id: number): Story {
  if (id <= 0) return emptyStory();
  for (const c of stories) {
    if (c.ID === id) return c;
  }
  return emptyStory();
}

function emptyStory(): Story {
  return {
    ID: 0,
    Name: '',
    StreetName: '',
    BuildingNumber: '',
    ApartmentNumber: '',
    PostalCode: '',
    City: '',
    ExternalID: '',
    RetailChainID: 0,
    RetailChainName: '',
    PurchaseCount: 0,
  };
}

function lineQuantity(line: Line): string {
  const q = line.Quantity.trim();
  if (q !== '') return q;
  return line.PackageCount.trim();
}

function newProductUnitID(line: Line, pieceUnitID: number, weightUnitID: number): number {
  const qty = lineQuantity(line);
  if (qty === '') return 0;
  if (scaleQty(qty)) return weightUnitID;
  return pieceUnitID;
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
    ID: 0,
    Name: '',
    StreetName: v.StreetName,
    BuildingNumber: v.BuildingNumber,
    ApartmentNumber: v.ApartmentNumber,
    PostalCode: v.PostalCode,
    City: v.City,
    ExternalID: '',
    RetailChainID: 0,
    RetailChainName: '',
    PurchaseCount: 0,
  });
  if (v.StoryName === '') return addr;
  if (addr === '') return v.StoryName;
  return v.StoryName + ' — ' + addr;
}

function createStoryURL(v: ReceiptView): string {
  if (v.Status === RECEIPT_MIGRATED || v.StoryID !== 0 || v.ReceiptID <= 0) return '';
  if (v.StoryName.trim() === '' && v.StreetName.trim() === '' && v.City.trim() === '' && v.ExternalID.trim() === '') {
    return '';
  }
  const q = new URLSearchParams();
  const set = (key: string, val: string) => {
    const s = val.trim();
    if (s !== '') q.set(prefillQuery(key), s);
  };
  set('name', v.StoryName);
  set('external_id', v.ExternalID);
  set('street_name', v.StreetName);
  set('building_number', v.BuildingNumber);
  set('apartment_number', v.ApartmentNumber);
  set('postal_code', v.PostalCode);
  set('city', v.City);
  q.set('next', '/admin/receipts/' + String(v.ReceiptID));
  return '/admin/stories/new?' + q.toString();
}

function baseView(receiptID: number, imagePath: string, status: string): ReceiptView {
  return {
    ReceiptID: receiptID,
    ImagePath: imagePath,
    Status: status,
    BoughtOn: '',
    BoughtAt: '',
    Notes: '',
    StoryID: 0,
    StoryName: '',
    ExternalID: '',
    StreetName: '',
    BuildingNumber: '',
    ApartmentNumber: '',
    PostalCode: '',
    City: '',
    Lines: [],
    Migrated: false,
    AddressLine: '',
    CreateStoryURL: '',
  };
}

export function decorateReceiptView(view: ReceiptView): ReceiptView {
  return decorateView(view);
}

function decorateView(view: ReceiptView): ReceiptView {
  view.Migrated = view.Status === RECEIPT_MIGRATED;
  view.AddressLine = addressLine(view);
  view.CreateStoryURL = createStoryURL(view);
  return view;
}

function emptyImport(): BillImport {
  return { StoryID: 0, Story: null, ReceiptID: 0, BoughtOn: '', Lines: [] };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
