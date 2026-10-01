import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { ComparisonGroupsRepository } from '#app/store/comparison-groups';
import { ProductsRepository } from '#app/store/products';
import { UnitsRepository } from '#app/store/units';
import { type ComparisonGroupRequest } from './contract/request.js';
import {
  AdminComparisonGroupDeletedResponse,
  AdminComparisonGroupFormResponse,
  AdminComparisonGroupResponse,
  AdminComparisonGroupsResponse,
} from './contract/response.js';

@Injectable()
export class AdminGroupsHandler {
  constructor(
    private readonly groups: ComparisonGroupsRepository,
    private readonly units: UnitsRepository,
    private readonly products: ProductsRepository,
  ) {}

  list(): AdminComparisonGroupsResponse {
    return AdminComparisonGroupsResponse.parse({ groups: this.groups.listComparisonGroups() });
  }

  blank(): AdminComparisonGroupFormResponse {
    return this.form({ id: 0, name: '', unitId: 0, unitName: '', createdAt: '', productCount: 0 }, []);
  }

  get(groupId: number): AdminComparisonGroupFormResponse {
    const group = this.groups.getComparisonGroup(groupId);
    return this.form(group, this.groups.listComparisonGroupProductIDs(groupId));
  }

  create(body: z.infer<typeof ComparisonGroupRequest>): AdminComparisonGroupResponse {
    return AdminComparisonGroupResponse.parse(
      this.groups.createComparisonGroup(body.name, body.unit_id, body.product_id),
    );
  }

  update(groupId: number, body: z.infer<typeof ComparisonGroupRequest>): AdminComparisonGroupResponse {
    this.groups.getComparisonGroup(groupId);
    this.groups.updateComparisonGroup(groupId, body.name, body.unit_id, body.product_id);
    return AdminComparisonGroupResponse.parse(this.groups.getComparisonGroup(groupId));
  }

  remove(groupId: number): AdminComparisonGroupDeletedResponse {
    const group = this.groups.getComparisonGroup(groupId);
    this.groups.deleteComparisonGroup(groupId);
    return AdminComparisonGroupDeletedResponse.parse({ ok: true, name: group.name });
  }

  private form(
    group: { id: number; name: string; unitId: number; unitName: string; createdAt: string; productCount: number },
    selected: number[],
  ): AdminComparisonGroupFormResponse {
    const set = new Set(selected);
    return AdminComparisonGroupFormResponse.parse({
      group,
      units: this.units.listUnits(),
      products: this.products.listProducts('').map((product) => ({ ...product, selected: set.has(product.id) })),
    });
  }
}
