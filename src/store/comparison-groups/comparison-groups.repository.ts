import { Injectable } from '@nestjs/common';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { alias as tableAlias } from 'drizzle-orm/sqlite-core';
import Decimal from 'decimal.js';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, lastId, nocaseOrder } from '../../db/query';
import { comparisonGroupProducts, comparisonGroups, productUnitConversions, products, units } from '../../db/schema';
import {
  DuplicateError,
  InvalidComparisonGroupError,
  InvalidUnitError,
  isUniqueErr,
  NotFoundError,
} from '../../domain/errors';
import { lastPricesByProduct, quotesByProduct } from '../../domain/price-stats';
import type {
  ComparisonGroup,
  ComparisonOffer,
  GroupComparison,
  RelatedProduct,
} from './comparison-groups.models';
import { mapProduct } from '@app/store/products/product-row';
import { nowRFC3339 } from '@app/store/now';
import { PurchasesRepository } from '@app/store/purchases';
import { UnitsRepository } from '@app/store/units';

const groupMemberCount = sql<number>`cast((
  select count(*) from comparison_group_products m where m.group_id = ${comparisonGroups.id}
) as integer)`.mapWith(Number);

type ComparisonMemberRow = {
  groupId: number;
  groupName: string;
  groupUnitId: number;
  groupUnitName: string;
  productId: number;
  productName: string;
  productUnitId: number;
  conversionFactor: string | null;
};

@Injectable()
export class ComparisonGroupsRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly units: UnitsRepository,
    private readonly purchases: PurchasesRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

  listComparisonGroups(): ComparisonGroup[] {
    return this.groupQuery().orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id).all();
  }

  getComparisonGroup(id: number): ComparisonGroup {
    const row = this.groupQuery().where(eq(comparisonGroups.id, id)).get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createComparisonGroup(name: string, unitId: number, productIds: number[]): ComparisonGroup {
    try {
      this.units.getUnit(unitId);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    const id = this.db.immediate(() => {
      let gid: number;
      try {
        gid = lastId(
          this.orm.insert(comparisonGroups).values({ name, unitId, createdAt: nowRFC3339() }).run(),
        );
      } catch (err) {
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(gid, productIds);
      return gid;
    });
    return this.getComparisonGroup(id);
  }

  updateComparisonGroup(id: number, name: string, unitId: number, productIds: number[]): void {
    try {
      this.units.getUnit(unitId);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    this.db.immediate(() => {
      try {
        const n = changesOf(
          this.orm.update(comparisonGroups).set({ name, unitId }).where(eq(comparisonGroups.id, id)).run(),
        );
        if (n === 0) throw new NotFoundError();
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(id, productIds);
    });
  }

  deleteComparisonGroup(id: number): void {
    const n = changesOf(this.orm.delete(comparisonGroups).where(eq(comparisonGroups.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  listComparisonGroupProductIDs(groupId: number): number[] {
    return this.orm
      .select({ productId: comparisonGroupProducts.productId })
      .from(comparisonGroupProducts)
      .where(eq(comparisonGroupProducts.groupId, groupId))
      .orderBy(comparisonGroupProducts.productId)
      .all()
      .map((r) => r.productId);
  }

  listComparisonGroupsForProduct(productId: number): ComparisonGroup[] {
    return this.orm
      .select({
        id: comparisonGroups.id,
        name: comparisonGroups.name,
        unitId: comparisonGroups.unitId,
        unitName: units.name,
        createdAt: comparisonGroups.createdAt,
        productCount: groupMemberCount,
      })
      .from(comparisonGroupProducts)
      .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonGroupProducts.groupId))
      .innerJoin(units, eq(units.id, comparisonGroups.unitId))
      .where(eq(comparisonGroupProducts.productId, productId))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id)
      .all();
  }

  setProductComparisonGroups(productId: number, groupIds: number[]): void {
    this.requireProduct(productId);
    this.db.immediate(() => {
      const ids = this.uniquePositiveIDs(groupIds);
      for (const id of ids) {
        const n = this.orm.select({ n: count() }).from(comparisonGroups).where(eq(comparisonGroups.id, id)).get();
        if (countOf(n?.n) === 0) throw new InvalidComparisonGroupError();
      }
      this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.productId, productId)).run();
      for (const id of ids) {
        this.orm.insert(comparisonGroupProducts).values({ groupId: id, productId }).run();
      }
    });
  }

  relatedGroupProducts(productId: number, now: Date): RelatedProduct[] {
    this.requireProduct(productId);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const rows = this.orm
      .selectDistinct({
        id: products.id,
        name: products.name,
        ean: products.ean,
        unitId: products.unitId,
        unitName: units.name,
        imagePath: products.imagePath,
        createdAt: products.createdAt,
      })
      .from(mine)
      .innerJoin(member, eq(member.groupId, mine.groupId))
      .innerJoin(products, eq(products.id, member.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(and(eq(mine.productId, productId), ne(products.id, productId)))
      .orderBy(nocaseOrder(products.name), products.id)
      .all();
    if (rows.length === 0) return [];
    const buys = this.purchases.listPurchasesForProductIDs(rows.map((r) => r.id));
    const quotes = quotesByProduct(buys, now);
    const out: RelatedProduct[] = [];
    for (const r of rows) {
      const q = quotes.get(r.id);
      if (!q) continue;
      out.push({ ...mapProduct(r), quote: q });
    }
    return out;
  }

  comparisonLeaders(productId: number): GroupComparison[] {
    this.requireProduct(productId);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const members = this.orm
      .select({
        groupId: comparisonGroups.id,
        groupName: comparisonGroups.name,
        groupUnitId: comparisonGroups.unitId,
        groupUnitName: units.name,
        productId: products.id,
        productName: products.name,
        productUnitId: products.unitId,
        conversionFactor: productUnitConversions.factor,
      })
      .from(mine)
      .innerJoin(comparisonGroups, eq(comparisonGroups.id, mine.groupId))
      .innerJoin(units, eq(units.id, comparisonGroups.unitId))
      .innerJoin(member, eq(member.groupId, comparisonGroups.id))
      .innerJoin(products, eq(products.id, member.productId))
      .leftJoin(
        productUnitConversions,
        and(
          eq(productUnitConversions.productId, products.id),
          eq(productUnitConversions.unitId, comparisonGroups.unitId),
        ),
      )
      .where(eq(mine.productId, productId))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id, nocaseOrder(products.name), products.id)
      .all();
    if (members.length === 0) return [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const m of members) {
      if (seen.has(m.productId)) continue;
      seen.add(m.productId);
      ids.push(m.productId);
    }
    const last = lastPricesByProduct(this.purchases.listPurchasesForProductIDs(ids));
    return this.pickGroupLeaders(productId, members, last);
  }

  reassignProduct(fromId: number, intoId: number): void {
    const groupRows = this.orm
      .select({ groupId: comparisonGroupProducts.groupId })
      .from(comparisonGroupProducts)
      .where(eq(comparisonGroupProducts.productId, fromId))
      .all();
    for (const row of groupRows) {
      this.orm
        .insert(comparisonGroupProducts)
        .values({ groupId: row.groupId, productId: intoId })
        .onConflictDoNothing()
        .run();
    }
  }

  private pickGroupLeaders(
    selectedId: number,
    members: ComparisonMemberRow[],
    last: Map<number, { boughtOn: string; price: Decimal }>,
  ): GroupComparison[] {
    const out: GroupComparison[] = [];
    let idx = -1;
    for (const m of members) {
      if (idx < 0 || out[idx]!.group.id !== m.groupId) {
        out.push({
          group: {
            id: m.groupId,
            name: m.groupName,
            unitId: m.groupUnitId,
            unitName: m.groupUnitName,
            createdAt: '',
            productCount: 0,
          },
          selected: null,
          leader: null,
          selectedIsLeader: false,
          selectedComparable: false,
        });
        idx = out.length - 1;
      }
      const offer = this.comparableOffer(m, last);
      if (!offer) continue;
      if (m.productId === selectedId) {
        out[idx]!.selected = offer;
        out[idx]!.selectedComparable = true;
      }
      if (this.betterOffer(offer, out[idx]!.leader, selectedId)) out[idx]!.leader = offer;
    }
    for (const g of out) {
      if (g.leader && g.selected && g.leader.productId === selectedId) g.selectedIsLeader = true;
    }
    return out;
  }

  private comparableOffer(
    m: {
      productId: number;
      productName: string;
      productUnitId: number;
      groupUnitId: number;
      conversionFactor: string | null;
    },
    last: Map<number, { boughtOn: string; price: Decimal }>,
  ): ComparisonOffer | null {
    const pt = last.get(m.productId);
    if (!pt) return null;
    let factor: Decimal;
    if (m.productUnitId === m.groupUnitId) factor = new Decimal(1);
    else if (!m.conversionFactor) return null;
    else {
      factor = new Decimal(m.conversionFactor);
      if (factor.isZero() || factor.isNegative()) return null;
    }
    return {
      productId: m.productId,
      productName: m.productName,
      price: pt.price.div(factor),
      boughtOn: pt.boughtOn,
    };
  }

  private betterOffer(candidate: ComparisonOffer, current: ComparisonOffer | null, selectedId: number): boolean {
    if (!current) return true;
    if (candidate.price.lt(current.price)) return true;
    if (current.price.lt(candidate.price)) return false;
    if (candidate.productId === selectedId) return true;
    if (current.productId === selectedId) return false;
    return candidate.productId < current.productId;
  }

  private groupQuery() {
    return this.orm
      .select({
        id: comparisonGroups.id,
        name: comparisonGroups.name,
        unitId: comparisonGroups.unitId,
        unitName: units.name,
        createdAt: comparisonGroups.createdAt,
        productCount: groupMemberCount,
      })
      .from(comparisonGroups)
      .innerJoin(units, eq(units.id, comparisonGroups.unitId));
  }

  private setComparisonGroupProducts(groupId: number, productIds: number[]): void {
    const ids = this.uniquePositiveIDs(productIds);
    for (const id of ids) {
      this.requireProduct(id);
    }
    this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.groupId, groupId)).run();
    for (const id of ids) {
      this.orm.insert(comparisonGroupProducts).values({ groupId, productId: id }).run();
    }
  }

  private uniquePositiveIDs(ids: number[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of ids) {
      if (id === 0) continue;
      if (id < 0) throw new NotFoundError();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private requireProduct(id: number): void {
    const n = this.orm.select({ n: count() }).from(products).where(eq(products.id, id)).get();
    if (countOf(n?.n) === 0) throw new NotFoundError();
  }
}
