import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const units = sqliteTable('units', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

export const products = sqliteTable('products', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  unitId: integer('unit_id').notNull(),
  imagePath: text('image_path'),
  createdAt: text('created_at').notNull(),
});

export const retailChains = sqliteTable('retail_chains', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  legalName: text('legal_name').notNull(),
  taxId: text('tax_id').notNull(),
});

export const stories = sqliteTable('stories', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  streetName: text('street_name').notNull(),
  buildingNumber: text('building_number').notNull(),
  apartmentNumber: text('apartment_number').notNull().default(''),
  postalCode: text('postal_code').notNull(),
  city: text('city').notNull(),
  retailChainId: integer('retail_chain_id'),
  externalId: text('external_id').notNull().default(''),
});

export const receipts = sqliteTable('receipts', {
  id: integer('id').primaryKey(),
  imagePath: text('image_path').notNull(),
  rawResponse: text('raw_response').notNull().default(''),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  errorMessage: text('error_message').notNull().default(''),
  source: text('source').notNull(),
  externalId: text('external_id').notNull().default(''),
  sourcePayload: text('source_payload').notNull().default(''),
});

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey(),
  productId: integer('product_id').notNull(),
  storyId: integer('story_id'),
  boughtOn: text('bought_on').notNull(),
  quantity: text('quantity').notNull(),
  amount: text('amount').notNull(),
  createdAt: text('created_at').notNull(),
  kind: text('kind').notNull().default('purchase'),
  receiptId: integer('receipt_id'),
});

export const productAliases = sqliteTable('product_aliases', {
  id: integer('id').primaryKey(),
  productId: integer('product_id').notNull(),
  storyId: integer('story_id'),
  retailChainId: integer('retail_chain_id'),
  alias: text('alias').notNull(),
});

export const productUnitConversions = sqliteTable('product_unit_conversions', {
  productId: integer('product_id').notNull(),
  unitId: integer('unit_id').notNull(),
  factor: text('factor').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const comparisonGroups = sqliteTable('comparison_groups', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  unitId: integer('unit_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const comparisonGroupProducts = sqliteTable('comparison_group_products', {
  groupId: integer('group_id').notNull(),
  productId: integer('product_id').notNull(),
});
