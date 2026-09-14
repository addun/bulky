import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const units = sqliteTable(
  'units',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('units_name').on(t.name)],
);

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    unitId: integer('unit_id')
      .notNull()
      .references(() => units.id),
    imagePath: text('image_path'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_products_name').on(t.name)],
);

export const retailChains = sqliteTable(
  'retail_chains',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    taxId: text('tax_id').notNull(),
  },
  (t) => [uniqueIndex('retail_chains_name').on(t.name), uniqueIndex('retail_chains_tax_id').on(t.taxId)],
);

export const stories = sqliteTable(
  'stories',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    streetName: text('street_name').notNull(),
    buildingNumber: text('building_number').notNull(),
    apartmentNumber: text('apartment_number').notNull().default(''),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    retailChainId: integer('retail_chain_id').references(() => retailChains.id),
    externalId: text('external_id').notNull().default(''),
  },
  (t) => [
    index('idx_stories_name').on(t.name),
    index('idx_stories_retail_chain').on(t.retailChainId),
    uniqueIndex('idx_stories_external_id')
      .on(t.externalId)
      .where(sql`external_id != ''`),
  ],
);

export const receipts = sqliteTable(
  'receipts',
  {
    id: integer('id').primaryKey(),
    imagePath: text('image_path').notNull(),
    rawResponse: text('raw_response').notNull().default(''),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    errorMessage: text('error_message').notNull().default(''),
    source: text('source').notNull(),
    externalId: text('external_id').notNull().default(''),
    sourcePayload: text('source_payload').notNull().default(''),
  },
  (t) => [
    index('idx_receipts_status').on(t.status),
    uniqueIndex('idx_receipts_source_external')
      .on(t.source, t.externalId)
      .where(sql`source != '' AND external_id != ''`),
  ],
);

export const purchases = sqliteTable(
  'purchases',
  {
    id: integer('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storyId: integer('story_id').references(() => stories.id),
    boughtOn: text('bought_on').notNull(),
    quantity: text('quantity').notNull(),
    amount: text('amount').notNull(),
    createdAt: text('created_at').notNull(),
    kind: text('kind').notNull().default('purchase'),
    receiptId: integer('receipt_id').references(() => receipts.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('idx_purchases_product').on(t.productId, t.boughtOn),
    index('idx_purchases_story').on(t.storyId),
    index('idx_purchases_receipt').on(t.receiptId),
  ],
);

export const productAliases = sqliteTable(
  'product_aliases',
  {
    id: integer('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storyId: integer('story_id').references(() => stories.id, { onDelete: 'cascade' }),
    retailChainId: integer('retail_chain_id').references(() => retailChains.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
  },
  (t) => [
    check('product_aliases_scope', sql`NOT (story_id IS NOT NULL AND retail_chain_id IS NOT NULL)`),
    index('idx_product_aliases_product').on(t.productId),
    uniqueIndex('idx_product_aliases_shop')
      .on(t.storyId, t.alias)
      .where(sql`story_id IS NOT NULL`),
    uniqueIndex('idx_product_aliases_chain')
      .on(t.retailChainId, t.alias)
      .where(sql`retail_chain_id IS NOT NULL`),
    uniqueIndex('idx_product_aliases_global')
      .on(t.alias)
      .where(sql`story_id IS NULL AND retail_chain_id IS NULL`),
  ],
);

export const productUnitConversions = sqliteTable(
  'product_unit_conversions',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    unitId: integer('unit_id')
      .notNull()
      .references(() => units.id),
    factor: text('factor').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.unitId] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const comparisonGroups = sqliteTable(
  'comparison_groups',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    unitId: integer('unit_id')
      .notNull()
      .references(() => units.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('comparison_groups_name').on(t.name), index('idx_comparison_groups_unit').on(t.unitId)],
);

export const comparisonGroupProducts = sqliteTable(
  'comparison_group_products',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => comparisonGroups.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.productId] }),
    index('idx_comparison_group_products_product').on(t.productId),
  ],
);
