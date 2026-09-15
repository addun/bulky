export const DefaultBaseURL = 'https://api.openai.com/v1';
export const MaxImageBytes = 10 << 20;

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotConfiguredError extends OcrError {
  constructor() {
    super('ocr is not configured');
  }
}

export class NoImageError extends OcrError {
  constructor() {
    super('image is required');
  }
}

export class NotABillError extends OcrError {
  constructor() {
    super('the photo does not look like a bill');
  }
}

export class NoLinesError extends OcrError {
  constructor() {
    super('no products found on this bill');
  }
}

export class NoPDFTextError extends OcrError {
  constructor(message = 'this PDF could not be read as images') {
    super(message);
  }
}

export class NoModelError extends OcrError {
  constructor() {
    super('ocr model is not set');
  }
}

export type Config = {
  APIKey: string;
  BaseURL: string;
  Model: string;
};

export function normalizeBaseURL(s: string): string {
  s = s.trim().replace(/\/+$/, '');
  if (s.endsWith('/chat/completions')) {
    s = s.slice(0, -'/chat/completions'.length);
  }
  return s;
}

export function configured(c: Config): boolean {
  if (c.APIKey !== '') return true;
  const base = normalizeBaseURL(c.BaseURL);
  return base !== '' && base !== DefaultBaseURL;
}

export type Bill = {
  boughtOn: string;
  boughtAt: string;
  notes: string;
  notABill: boolean;
  storyId: number;
  storyName: string;
  externalId: string;
  streetName: string;
  buildingNumber: string;
  apartmentNumber: string;
  postalCode: string;
  city: string;
  lines: Line[];
};

export type Line = {
  receiptName: string;
  productName: string;
  productId: number;
  unitId: number;
  unitName: string;
  vatType: string;
  packageCount: string;
  packageSize: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  amount: string;
  skip: boolean;
  skipReason: string;
  ean: string;
};

export function emptyBill(): Bill {
  return {
    boughtOn: '',
    boughtAt: '',
    notes: '',
    notABill: false,
    storyId: 0,
    storyName: '',
    externalId: '',
    streetName: '',
    buildingNumber: '',
    apartmentNumber: '',
    postalCode: '',
    city: '',
    lines: [],
  };
}

export function emptyLine(): Line {
  return {
    receiptName: '',
    productName: '',
    productId: 0,
    unitId: 0,
    unitName: '',
    vatType: '',
    packageCount: '',
    packageSize: '',
    quantity: '',
    unitPrice: '',
    discount: '',
    amount: '',
    skip: false,
    skipReason: '',
    ean: '',
  };
}

export function productLines(bill: Bill): Line[] {
  return bill.lines.filter((line) => !line.skip);
}

export function marshalBill(bill: Bill): string {
  const raw: Record<string, unknown> = {
    bought_on: bill.boughtOn,
    notes: bill.notes,
    not_a_bill: bill.notABill,
    lines: bill.lines.map(marshalLine),
  };
  if (bill.boughtAt !== '') raw.bought_at = bill.boughtAt;
  if (bill.storyId !== 0) raw.company_id = bill.storyId;
  if (bill.storyName !== '') raw.company_name = bill.storyName;
  if (bill.externalId !== '') raw.external_id = bill.externalId;
  if (bill.streetName !== '') raw.street_name = bill.streetName;
  if (bill.buildingNumber !== '') raw.building_number = bill.buildingNumber;
  if (bill.apartmentNumber !== '') raw.apartment_number = bill.apartmentNumber;
  if (bill.postalCode !== '') raw.postal_code = bill.postalCode;
  if (bill.city !== '') raw.city = bill.city;
  return JSON.stringify(raw);
}

function marshalLine(line: Line): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    receipt_name: line.receiptName,
    product_name: line.productName,
    product_id: line.productId,
    unit_id: line.unitId,
    unit_name: line.unitName,
    package_count: line.packageCount,
    package_size: line.packageSize,
    quantity: line.quantity,
    amount: line.amount,
    skip: line.skip,
    skip_reason: line.skipReason,
  };
  if (line.vatType !== '') raw.vat_type = line.vatType;
  if (line.unitPrice !== '') raw.unit_price = line.unitPrice;
  if (line.discount !== '') raw.discount = line.discount;
  if (line.ean !== '') raw.ean = line.ean;
  return raw;
}
