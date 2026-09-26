import { Decimal } from 'decimal.js';
import type { QuotedPrice } from '../../domain/price-stats.js';
import type { Product } from '../products/products.models.js';

export type ComparisonGroup = {
  id: number;
  name: string;
  unitId: number;
  unitName: string;
  createdAt: string;
  productCount: number;
};

export type ComparisonOffer = {
  productId: number;
  productName: string;
  price: Decimal;
  boughtOn: string;
};

export type GroupComparison = {
  group: ComparisonGroup;
  selected: ComparisonOffer | null;
  leader: ComparisonOffer | null;
  selectedIsLeader: boolean;
  selectedComparable: boolean;
};

export type RelatedProduct = Product & {
  quote: QuotedPrice | null;
};
