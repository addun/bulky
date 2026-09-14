import Decimal from 'decimal.js';
import type { QuotedPrice } from '../../domain/price-stats';
import type { Product } from '../products/products.models';

export type ComparisonGroup = {
  ID: number;
  Name: string;
  UnitID: number;
  UnitName: string;
  CreatedAt: string;
  ProductCount: number;
};

export type ComparisonOffer = {
  ProductID: number;
  ProductName: string;
  Price: Decimal;
  BoughtOn: string;
};

export type GroupComparison = {
  Group: ComparisonGroup;
  Selected: ComparisonOffer | null;
  Leader: ComparisonOffer | null;
  SelectedIsLeader: boolean;
  SelectedComparable: boolean;
};

export type RelatedProduct = Product & {
  Quote: QuotedPrice | null;
};
