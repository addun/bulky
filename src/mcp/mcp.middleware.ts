import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { McpService } from './mcp.service';

@Injectable()
export class McpMiddleware implements NestMiddleware {
  constructor(private readonly mcp: McpService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    void this.mcp.handle(req, res).catch((err: unknown) => next(err));
  }
}
