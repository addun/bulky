import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../../db/database.service.js';
import { changesOf, countOf, lastId, nocaseEq, nocaseOrder } from '../../db/query.js';
import { comparisonGroups, settings, units } from '../../db/schema.js';
import { DuplicateError, InvalidUnitError, isUniqueErr, NotFoundError, UnitInUseError } from '../../domain/errors.js';
import {
  SETTING_OCR_MODEL,
  SETTING_PIECE_UNIT_ID,
  SETTING_WEIGHT_UNIT_ID,
  type Unit,
  type UnitDefaults,
} from './units.models.js';

const unitUseCount = sql<number>`cast((
  select count(*) from products p where p.unit_id = ${units.id}
) + (
  select count(*) from product_unit_conversions c where c.unit_id = ${units.id}
) as integer)`.mapWith(Number);

@Injectable()
export class UnitsRepository {
  constructor(private readonly db: DatabaseService) {}

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
      if (isUniqueErr(err)) throw new DuplicateError();
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
      if (isUniqueErr(err)) throw new DuplicateError();
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

  getSetting(key: string): string {
    const row = this.orm.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? '';
  }

  setSetting(key: string, value: string): void {
    this.orm
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  unitDefaults(): UnitDefaults {
    return { pieceId: this.settingUnitID(SETTING_PIECE_UNIT_ID), weightId: this.settingUnitID(SETTING_WEIGHT_UNIT_ID) };
  }

  setUnitDefaults(d: UnitDefaults): void {
    this.setSettingUnitID(SETTING_PIECE_UNIT_ID, d.pieceId);
    this.setSettingUnitID(SETTING_WEIGHT_UNIT_ID, d.weightId);
  }

  ocrModel(): string {
    return this.getSetting(SETTING_OCR_MODEL);
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

  private settingUnitID(key: string): number | null {
    const raw = this.getSetting(key);
    if (raw === '') return null;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      this.getUnit(id);
      return id;
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  private setSettingUnitID(key: string, id: number | null): void {
    if (!id) {
      this.orm.delete(settings).where(eq(settings.key, key)).run();
      return;
    }
    try {
      this.getUnit(id);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidUnitError();
      throw err;
    }
    this.setSetting(key, String(id));
  }
}
