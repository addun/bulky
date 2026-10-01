import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { ComparisonGroupRequest, Id } from './contract/request.js';
import {
  type AdminComparisonGroupDeletedResponse,
  type AdminComparisonGroupFormResponse,
  type AdminComparisonGroupResponse,
  type AdminComparisonGroupsResponse,
} from './contract/response.js';
import { AdminGroupsHandler } from './groups.handler.js';

@Controller()
export class AdminGroupsController {
  constructor(private readonly handler: AdminGroupsHandler) {}

  @Get('/api/admin/comparison-groups')
  list(): AdminComparisonGroupsResponse {
    return this.handler.list();
  }

  @Get('/api/admin/comparison-groups/new')
  blank(): AdminComparisonGroupFormResponse {
    return this.handler.blank();
  }

  @Get('/api/admin/comparison-groups/:id')
  get(@Param('id', { schema: Id }) groupId: number): AdminComparisonGroupFormResponse {
    return this.handler.get(groupId);
  }

  @Post('/api/admin/comparison-groups')
  create(@Body({ schema: ComparisonGroupRequest }) body: z.infer<typeof ComparisonGroupRequest>): AdminComparisonGroupResponse {
    return this.handler.create(body);
  }

  @Patch('/api/admin/comparison-groups/:id')
  update(
    @Param('id', { schema: Id }) groupId: number,
    @Body({ schema: ComparisonGroupRequest }) body: z.infer<typeof ComparisonGroupRequest>,
  ): AdminComparisonGroupResponse {
    return this.handler.update(groupId, body);
  }

  @Delete('/api/admin/comparison-groups/:id')
  remove(@Param('id', { schema: Id }) groupId: number): AdminComparisonGroupDeletedResponse {
    return this.handler.remove(groupId);
  }
}
