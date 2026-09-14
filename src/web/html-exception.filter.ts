import { Catch, ExceptionFilter, ArgumentsHost, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(BadRequestException)
export class HtmlExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    if (req.path.startsWith('/api/') || req.path === '/mcp' || req.path.startsWith('/mcp/')) {
      res.status(400).json(exception.getResponse());
      return;
    }
    res.status(404).type('text/plain').send('not found');
  }
}
