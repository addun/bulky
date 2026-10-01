import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, lastId, nocaseEq, nocaseOrder } from '../../db/query.js';
import { comparisonGroups, units } from '../../db/schema.js';
import { DuplicateError, InvalidUnitError, isUniqueErr, NotFoundError, UnitInUseError } from '../../domain/errors.js';
import { SettingsRepository } from '#app/store/settings';
import { type Unit, type UnitDefaults } from './units.models.js';

const unitUseCount = sql<number>`cast((
  select count(*) from products p where p.unit_id = ${units.id}
) + (
  select count(*) from product_unit_conversions c where c.unit_id = ${units.id}
) as integer)`.mapWith(Number);

@Injectable()
export class UnitsRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsRepository,
  ) {}

  private get orm() {
    return this.db.drizzle;
  }

  listUnits(): Unit[] {
    return this.orm
      .select(this.unitColumns())
      .from(units)
      .orderBy(nocaseOrder(units.name))
      .all()
      .map((row) => this.mapUnit(row));
  }

  getUnit(id: number): Unit {
    const row = this.orm.select(this.unitColumns()).from(units).where(eq(units.id, id)).get();
    if (!row) throw new NotFoundError();
    return this.mapUnit(row);
  }

  findUnitByName(name: string): Unit {
    const row = this.orm.select(this.unitColumns()).from(units).where(nocaseEq(units.name, name)).get();
    if (!row) throw new NotFoundError();
    return this.mapUnit(row);
  }

  createUnit(name: string, compareValue?: Decimal): Unit {
    try {
      const id = lastId(
        this.orm
          .insert(units)
          .values(compareValue ? { name, compareValue: compareValue.toString() } : { name })
          .run(),
      );
      return this.getUnit(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError('That unit already exists.');
      throw err;
    }
  }

  updateUnit(id: number, name: string, compareValue: Decimal): void {
    try {
      const n = changesOf(
        this.orm.update(units).set({ name, compareValue: compareValue.toString() }).where(eq(units.id, id)).run(),
      );
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError('That unit already exists.');
      throw err;
    }
  }

  deleteUnit(id: number): void {
    const u = this.getUnit(id);
    if (u.productCount > 0) throw new UnitInUseError();
    const groups = this.orm
      .select({ n: count() })
      .from(comparisonGroups)
      .where(eq(comparisonGroups.unitId, id))
      .get();
    if (countOf(groups?.n) > 0) throw new UnitInUseError();
    const n = changesOf(this.orm.delete(units).where(eq(units.id, id)).run());
    if (n === 0) throw new NotFoundError();
  }

  unitDefaults(): UnitDefaults {
    return {
      pieceId: this.existingUnitId(this.settings.getSetting('piece_unit_id')),
      weightId: this.existingUnitId(this.settings.getSetting('weight_unit_id')),
    };
  }

  setUnitDefaults(d: UnitDefaults): void {
    this.requireUnit(d.pieceId);
    this.requireUnit(d.weightId);
    this.settings.setSetting('piece_unit_id', d.pieceId);
    this.settings.setSetting('weight_unit_id', d.weightId);
  }

  private unitColumns() {
    return {
      id: units.id,
      name: units.name,
      compareValue: units.compareValue,
      productCount: unitUseCount,
    };
  }

  private mapUnit(row: { id: number; name: string; compareValue: string; productCount: number }): Unit {
    return {
      id: row.id,
      name: row.name,
      compareValue: new Decimal(row.compareValue),
      productCount: row.productCount,
    };
  }

  private existingUnitId(id: number | null): number | null {
    if (id == null) return null;
    try {
      this.getUnit(id);
      return id;
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  private requireUnit(id: number | null): void {
    if (!id) return;
    try {
      this.getUnit(id);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
  }
}
