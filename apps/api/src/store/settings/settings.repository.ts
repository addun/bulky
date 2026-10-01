import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service.js';
import { settings } from '../../db/schema.js';

type SettingKey = 'ocr_model' | 'piece_unit_id' | 'weight_unit_id';

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  private get orm() {
    return this.db.drizzle;
  }

  getSetting(key: 'ocr_model'): string;
  getSetting(key: 'piece_unit_id' | 'weight_unit_id'): number | null;
  getSetting(key: SettingKey): string | number | null {
    const raw = this.read(key);
    if (key === 'ocr_model') return raw;
    return this.parseUnitId(raw);
  }

  setSetting(key: 'ocr_model', value: string): void;
  setSetting(key: 'piece_unit_id' | 'weight_unit_id', value: number | null): void;
  setSetting(key: SettingKey, value: string | number | null): void {
    if (typeof value === 'string') {
      this.write(key, value);
      return;
    }
    if (!value) {
      this.deleteSetting(key);
      return;
    }
    this.write(key, String(value));
  }

  deleteSetting(key: SettingKey): void {
    this.orm.delete(settings).where(eq(settings.key, key)).run();
  }

  private read(key: SettingKey): string {
    const row = this.orm.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? '';
  }

  private write(key: SettingKey, value: string): void {
    this.orm
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  private parseUnitId(raw: string): number | null {
    if (raw === '') return null;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
  }
}
