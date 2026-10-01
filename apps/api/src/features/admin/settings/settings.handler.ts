import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { nocaseOrder } from '../../../db/query.js';
import { settings, units } from '../../../db/schema.js';
import { InvalidUnitError } from '../../../domain/errors.js';
import { type UpdateAdminSettingsRequest } from './contract/request.js';
import { AdminSettingsResponse } from './contract/response.js';
import { DATABASE, type Database } from './database.js';

type SettingKey = 'ocr_model' | 'piece_unit_id' | 'weight_unit_id';

const unitUseCount = sql<number>`cast((
  select count(*) from products p where p.unit_id = ${units.id}
) + (
  select count(*) from product_unit_conversions c where c.unit_id = ${units.id}
) as integer)`.mapWith(Number);

@Injectable()
export class AdminSettingsHandler {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  get(): AdminSettingsResponse {
    const rows = this.database
      .select({
        id: units.id,
        name: units.name,
        compareValue: units.compareValue,
        productCount: unitUseCount,
      })
      .from(units)
      .orderBy(nocaseOrder(units.name))
      .all();
    const ids = new Set(rows.map((row) => row.id));

    return AdminSettingsResponse.parse({
      ocrModel: this.read('ocr_model'),
      units: rows,
      defaults: {
        pieceId: this.savedUnitId('piece_unit_id', ids),
        weightId: this.savedUnitId('weight_unit_id', ids),
      },
    });
  }

  update(body: z.infer<typeof UpdateAdminSettingsRequest>): AdminSettingsResponse {
    this.requireUnit(body.piece_unit_id);
    this.requireUnit(body.weight_unit_id);
    this.write('ocr_model', body.ocr_model);
    this.write('piece_unit_id', String(body.piece_unit_id));
    this.write('weight_unit_id', String(body.weight_unit_id));
    return this.get();
  }

  private requireUnit(id: number): void {
    const row = this.database.select({ id: units.id }).from(units).where(eq(units.id, id)).get();
    if (!row) throw new InvalidUnitError();
  }

  private savedUnitId(key: 'piece_unit_id' | 'weight_unit_id', ids: Set<number>): number | null {
    const raw = this.read(key);
    if (raw === '') return null;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0 || !ids.has(id)) return null;
    return id;
  }

  private read(key: SettingKey): string {
    const row = this.database.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? '';
  }

  private write(key: SettingKey, value: string): void {
    this.database
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }
}
