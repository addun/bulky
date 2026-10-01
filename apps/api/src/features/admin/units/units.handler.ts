import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import { parseDecimal } from '../../../domain/format.js';
import { UnitsRepository } from '#app/store/units';
import { type UnitRequest } from './contract/request.js';
import { AdminOkResponse, AdminUnitResponse, AdminUnitsResponse } from './contract/response.js';

@Injectable()
export class AdminUnitsHandler {
  constructor(private readonly units: UnitsRepository) {}

  list(): AdminUnitsResponse {
    return AdminUnitsResponse.parse({ units: this.units.listUnits() });
  }

  get(unitId: number): AdminUnitResponse {
    return AdminUnitResponse.parse(this.units.getUnit(unitId));
  }

  create(body: z.infer<typeof UnitRequest>): AdminUnitResponse {
    const compare = readCompareValue(body.compare_value);
    if (compare.error || !compare.value) throw new UnprocessableEntityException(compare.error || 'Compare value is required.');
    return AdminUnitResponse.parse(this.units.createUnit(body.name, compare.value));
  }

  update(unitId: number, body: z.infer<typeof UnitRequest>): AdminUnitResponse {
    const compare = readCompareValue(body.compare_value);
    if (compare.error || !compare.value) throw new UnprocessableEntityException(compare.error || 'Compare value is required.');
    this.units.updateUnit(unitId, body.name, compare.value);
    return AdminUnitResponse.parse(this.units.getUnit(unitId));
  }

  remove(unitId: number): AdminOkResponse {
    const unit = this.units.getUnit(unitId);
    if (unit.productCount > 0) throw new ConflictException(`Cannot delete “${unit.name}” while a product still uses it.`);
    this.units.deleteUnit(unitId);
    return AdminOkResponse.parse({ ok: true });
  }
}

function readCompareValue(raw: string): { value: Decimal | null; error: string } {
  try {
    return { value: parseDecimal(raw, 6, false), error: '' };
  } catch (err) {
    const message = (err as Error).message;
    return { value: null, error: message.endsWith('.') ? `Compare value ${message}` : `Compare value ${message}.` };
  }
}
