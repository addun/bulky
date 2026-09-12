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
  BoughtOn: string;
  BoughtAt: string;
  Notes: string;
  NotABill: boolean;
  StoryID: number;
  StoryName: string;
  ExternalID: string;
  StreetName: string;
  BuildingNumber: string;
  ApartmentNumber: string;
  PostalCode: string;
  City: string;
  Lines: Line[];
};

export type Line = {
  ReceiptName: string;
  ProductName: string;
  ProductID: number;
  UnitID: number;
  UnitName: string;
  VatType: string;
  PackageCount: string;
  PackageSize: string;
  Quantity: string;
  UnitPrice: string;
  Discount: string;
  Amount: string;
  Skip: boolean;
  SkipReason: string;
};

export function emptyBill(): Bill {
  return {
    BoughtOn: '',
    BoughtAt: '',
    Notes: '',
    NotABill: false,
    StoryID: 0,
    StoryName: '',
    ExternalID: '',
    StreetName: '',
    BuildingNumber: '',
    ApartmentNumber: '',
    PostalCode: '',
    City: '',
    Lines: [],
  };
}

export function emptyLine(): Line {
  return {
    ReceiptName: '',
    ProductName: '',
    ProductID: 0,
    UnitID: 0,
    UnitName: '',
    VatType: '',
    PackageCount: '',
    PackageSize: '',
    Quantity: '',
    UnitPrice: '',
    Discount: '',
    Amount: '',
    Skip: false,
    SkipReason: '',
  };
}

export function productLines(bill: Bill): Line[] {
  return bill.Lines.filter((line) => !line.Skip);
}

export function marshalBill(bill: Bill): string {
  const raw: Record<string, unknown> = {
    bought_on: bill.BoughtOn,
    notes: bill.Notes,
    not_a_bill: bill.NotABill,
    lines: bill.Lines.map(marshalLine),
  };
  if (bill.BoughtAt !== '') raw.bought_at = bill.BoughtAt;
  if (bill.StoryID !== 0) raw.company_id = bill.StoryID;
  if (bill.StoryName !== '') raw.company_name = bill.StoryName;
  if (bill.ExternalID !== '') raw.external_id = bill.ExternalID;
  if (bill.StreetName !== '') raw.street_name = bill.StreetName;
  if (bill.BuildingNumber !== '') raw.building_number = bill.BuildingNumber;
  if (bill.ApartmentNumber !== '') raw.apartment_number = bill.ApartmentNumber;
  if (bill.PostalCode !== '') raw.postal_code = bill.PostalCode;
  if (bill.City !== '') raw.city = bill.City;
  return JSON.stringify(raw);
}

function marshalLine(line: Line): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    receipt_name: line.ReceiptName,
    product_name: line.ProductName,
    product_id: line.ProductID,
    unit_id: line.UnitID,
    unit_name: line.UnitName,
    package_count: line.PackageCount,
    package_size: line.PackageSize,
    quantity: line.Quantity,
    amount: line.Amount,
    skip: line.Skip,
    skip_reason: line.SkipReason,
  };
  if (line.VatType !== '') raw.vat_type = line.VatType;
  if (line.UnitPrice !== '') raw.unit_price = line.UnitPrice;
  if (line.Discount !== '') raw.discount = line.Discount;
  return raw;
}
