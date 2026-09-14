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
  GroupID: number;
  GroupName: string;
  GroupUnitID: number;
  GroupUnitName: string;
  ProductID: number;
  ProductName: string;
  ProductUnitID: number;
  ConversionFactor: string | null;
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

  createComparisonGroup(name: string, unitID: number, productIDs: number[]): ComparisonGroup {
    try {
      this.units.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    const id = this.db.immediate(() => {
      let gid: number;
      try {
        gid = lastId(
          this.orm.insert(comparisonGroups).values({ name, unitId: unitID, createdAt: nowRFC3339() }).run(),
        );
      } catch (err) {
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(gid, productIDs);
      return gid;
    });
    return this.getComparisonGroup(id);
  }

  updateComparisonGroup(id: number, name: string, unitID: number, productIDs: number[]): void {
    try {
      this.units.getUnit(unitID);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    this.db.immediate(() => {
      try {
        const n = changesOf(
          this.orm.update(comparisonGroups).set({ name, unitId: unitID }).where(eq(comparisonGroups.id, id)).run(),
        );
        if (n === 0) throw new NotFoundError();
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (isUniqueErr(err)) throw new DuplicateError();
        throw err;
      }
      this.setComparisonGroupProducts(id, productIDs);
    });
  }

  deleteComparisonGroup(id: number): void {
    const n = changesOf(this.orm.delete(comparisonGroups).where(eq(comparisonGroups.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  listComparisonGroupProductIDs(groupID: number): number[] {
    return this.orm
      .select({ productId: comparisonGroupProducts.productId })
      .from(comparisonGroupProducts)
      .where(eq(comparisonGroupProducts.groupId, groupID))
      .orderBy(comparisonGroupProducts.productId)
      .all()
      .map((r) => r.productId);
  }

  listComparisonGroupsForProduct(productID: number): ComparisonGroup[] {
    return this.orm
      .select({
        ID: comparisonGroups.id,
        Name: comparisonGroups.name,
        UnitID: comparisonGroups.unitId,
        UnitName: units.name,
        CreatedAt: comparisonGroups.createdAt,
        ProductCount: groupMemberCount,
      })
      .from(comparisonGroupProducts)
      .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonGroupProducts.groupId))
      .innerJoin(units, eq(units.id, comparisonGroups.unitId))
      .where(eq(comparisonGroupProducts.productId, productID))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id)
      .all();
  }

  setProductComparisonGroups(productID: number, groupIDs: number[]): void {
    this.requireProduct(productID);
    this.db.immediate(() => {
      const ids = this.uniquePositiveIDs(groupIDs);
      for (const id of ids) {
        const n = this.orm.select({ n: count() }).from(comparisonGroups).where(eq(comparisonGroups.id, id)).get();
        if (countOf(n?.n) === 0) throw new InvalidComparisonGroupError();
      }
      this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.productId, productID)).run();
      for (const id of ids) {
        this.orm.insert(comparisonGroupProducts).values({ groupId: id, productId: productID }).run();
      }
    });
  }

  relatedGroupProducts(productID: number, now: Date): RelatedProduct[] {
    this.requireProduct(productID);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const rows = this.orm
      .selectDistinct({
        ID: products.id,
        Name: products.name,
        UnitID: products.unitId,
        UnitName: units.name,
        image_path: products.imagePath,
        CreatedAt: products.createdAt,
      })
      .from(mine)
      .innerJoin(member, eq(member.groupId, mine.groupId))
      .innerJoin(products, eq(products.id, member.productId))
      .innerJoin(units, eq(units.id, products.unitId))
      .where(and(eq(mine.productId, productID), ne(products.id, productID)))
      .orderBy(nocaseOrder(products.name), products.id)
      .all();
    if (rows.length === 0) return [];
    const buys = this.purchases.listPurchasesForProductIDs(rows.map((r) => r.ID));
    const quotes = quotesByProduct(buys, now);
    const out: RelatedProduct[] = [];
    for (const r of rows) {
      const q = quotes.get(r.ID);
      if (!q) continue;
      out.push({ ...mapProduct(r), Quote: q });
    }
    return out;
  }

  comparisonLeaders(productID: number): GroupComparison[] {
    this.requireProduct(productID);
    const mine = tableAlias(comparisonGroupProducts, 'mine');
    const member = tableAlias(comparisonGroupProducts, 'm');
    const members = this.orm
      .select({
        GroupID: comparisonGroups.id,
        GroupName: comparisonGroups.name,
        GroupUnitID: comparisonGroups.unitId,
        GroupUnitName: units.name,
        ProductID: products.id,
        ProductName: products.name,
        ProductUnitID: products.unitId,
        ConversionFactor: productUnitConversions.factor,
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
      .where(eq(mine.productId, productID))
      .orderBy(nocaseOrder(comparisonGroups.name), comparisonGroups.id, nocaseOrder(products.name), products.id)
      .all();
    if (members.length === 0) return [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const m of members) {
      if (seen.has(m.ProductID)) continue;
      seen.add(m.ProductID);
      ids.push(m.ProductID);
    }
    const last = lastPricesByProduct(this.purchases.listPurchasesForProductIDs(ids));
    return this.pickGroupLeaders(productID, members, last);
  }

  reassignProduct(fromID: number, intoID: number): void {
    const groupRows = this.orm
      .select({ groupId: comparisonGroupProducts.groupId })
      .from(comparisonGroupProducts)
      .where(eq(comparisonGroupProducts.productId, fromID))
      .all();
    for (const row of groupRows) {
      this.orm
        .insert(comparisonGroupProducts)
        .values({ groupId: row.groupId, productId: intoID })
        .onConflictDoNothing()
        .run();
    }
  }

  private pickGroupLeaders(
    selectedID: number,
    members: ComparisonMemberRow[],
    last: Map<number, { BoughtOn: string; Price: Decimal }>,
  ): GroupComparison[] {
    const out: GroupComparison[] = [];
    let idx = -1;
    for (const m of members) {
      if (idx < 0 || out[idx]!.Group.ID !== m.GroupID) {
        out.push({
          Group: {
            ID: m.GroupID,
            Name: m.GroupName,
            UnitID: m.GroupUnitID,
            UnitName: m.GroupUnitName,
            CreatedAt: '',
            ProductCount: 0,
          },
          Selected: null,
          Leader: null,
          SelectedIsLeader: false,
          SelectedComparable: false,
        });
        idx = out.length - 1;
      }
      const offer = this.comparableOffer(m, last);
      if (!offer) continue;
      if (m.ProductID === selectedID) {
        out[idx]!.Selected = offer;
        out[idx]!.SelectedComparable = true;
      }
      if (this.betterOffer(offer, out[idx]!.Leader, selectedID)) out[idx]!.Leader = offer;
    }
    for (const g of out) {
      if (g.Leader && g.Selected && g.Leader.ProductID === selectedID) g.SelectedIsLeader = true;
    }
    return out;
  }

  private comparableOffer(
    m: {
      ProductID: number;
      ProductName: string;
      ProductUnitID: number;
      GroupUnitID: number;
      ConversionFactor: string | null;
    },
    last: Map<number, { BoughtOn: string; Price: Decimal }>,
  ): ComparisonOffer | null {
    const pt = last.get(m.ProductID);
    if (!pt) return null;
    let factor: Decimal;
    if (m.ProductUnitID === m.GroupUnitID) factor = new Decimal(1);
    else if (!m.ConversionFactor) return null;
    else {
      factor = new Decimal(m.ConversionFactor);
      if (factor.isZero() || factor.isNegative()) return null;
    }
    return {
      ProductID: m.ProductID,
      ProductName: m.ProductName,
      Price: pt.Price.div(factor),
      BoughtOn: pt.BoughtOn,
    };
  }

  private betterOffer(candidate: ComparisonOffer, current: ComparisonOffer | null, selectedID: number): boolean {
    if (!current) return true;
    if (candidate.Price.lt(current.Price)) return true;
    if (current.Price.lt(candidate.Price)) return false;
    if (candidate.ProductID === selectedID) return true;
    if (current.ProductID === selectedID) return false;
    return candidate.ProductID < current.ProductID;
  }

  private groupQuery() {
    return this.orm
      .select({
        ID: comparisonGroups.id,
        Name: comparisonGroups.name,
        UnitID: comparisonGroups.unitId,
        UnitName: units.name,
        CreatedAt: comparisonGroups.createdAt,
        ProductCount: groupMemberCount,
      })
      .from(comparisonGroups)
      .innerJoin(units, eq(units.id, comparisonGroups.unitId));
  }

  private setComparisonGroupProducts(groupID: number, productIDs: number[]): void {
    const ids = this.uniquePositiveIDs(productIDs);
    for (const id of ids) {
      this.requireProduct(id);
    }
    this.orm.delete(comparisonGroupProducts).where(eq(comparisonGroupProducts.groupId, groupID)).run();
    for (const id of ids) {
      this.orm.insert(comparisonGroupProducts).values({ groupId: groupID, productId: id }).run();
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
