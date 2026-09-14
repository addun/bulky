import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { changesOf, countOf, lastId, nocaseEq, nocaseOrder } from '../../db/query';
import { comparisonGroups, settings, units } from '../../db/schema';
import { DuplicateError, InvalidUnitError, isUniqueErr, NotFoundError, UnitInUseError } from '../../domain/errors';
import {
  SETTING_OCR_MODEL,
  SETTING_PIECE_UNIT_ID,
  SETTING_WEIGHT_UNIT_ID,
  type Unit,
  type UnitDefaults,
} from './units.models';

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
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .orderBy(nocaseOrder(units.name))
      .all();
  }

  getUnit(id: number): Unit {
    const row = this.orm
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .where(eq(units.id, id))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  findUnitByName(name: string): Unit {
    const row = this.orm
      .select({ ID: units.id, Name: units.name, ProductCount: unitUseCount })
      .from(units)
      .where(nocaseEq(units.name, name))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  createUnit(name: string): Unit {
    try {
      const id = lastId(this.orm.insert(units).values({ name }).run());
      return this.getUnit(id);
    } catch (err) {
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  updateUnit(id: number, name: string): void {
    try {
      const n = changesOf(this.orm.update(units).set({ name }).where(eq(units.id, id)).run());
      if (n === 0) throw new NotFoundError();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (isUniqueErr(err)) throw new DuplicateError();
      throw err;
    }
  }

  deleteUnit(id: number): void {
    const u = this.getUnit(id);
    if (u.ProductCount > 0) throw new UnitInUseError();
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
    return { PieceID: this.settingUnitID(SETTING_PIECE_UNIT_ID), WeightID: this.settingUnitID(SETTING_WEIGHT_UNIT_ID) };
  }

  setUnitDefaults(d: UnitDefaults): void {
    this.setSettingUnitID(SETTING_PIECE_UNIT_ID, d.PieceID);
    this.setSettingUnitID(SETTING_WEIGHT_UNIT_ID, d.WeightID);
  }

  ocrModel(): string {
    return this.getSetting(SETTING_OCR_MODEL);
  }

  private settingUnitID(key: string): number {
    const raw = this.getSetting(key);
    if (raw === '') return 0;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) return 0;
    try {
      this.getUnit(id);
      return id;
    } catch (err) {
      if (err instanceof NotFoundError) return 0;
      throw err;
    }
  }

  private setSettingUnitID(key: string, id: number): void {
    if (id === 0) {
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
