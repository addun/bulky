import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, NotFoundError, ReceiptMigratedError, ReceiptNotReadyError, RetailChainInUseError, StoreInUseError, UnitInUseError } from '../domain/errors.js';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const api = req.path.startsWith('/api/') || req.path === '/mcp' || req.path.startsWith('/mcp/');

    if (exception instanceof HttpException) {
      if (!api) {
        res.status(404).type('text/plain').send('not found');
        return;
      }
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const message = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : exception.message;
        res.status(status).json({ ...record, message });
        return;
      }
      res.status(status).json({ message: typeof body === 'string' ? body : exception.message });
      return;
    }

    if (!api) {
      res.status(500).type('text/plain').send('not found');
      return;
    }

    const mapped = problemFor(exception);
    if (mapped) {
      res.status(mapped.status).json({ message: mapped.message });
      return;
    }

    res.status(500).json({ message: 'Something went wrong.' });
  }
}

function problemFor(exception: unknown): { status: number; message: string } | null {
  if (exception instanceof NotFoundError) return { status: 404, message: 'Not found.' };
  if (exception instanceof UnitInUseError) return { status: 409, message: 'Cannot delete a unit while a product still uses it.' };
  if (exception instanceof StoreInUseError) return { status: 409, message: 'Cannot delete a store while a purchase still uses it.' };
  if (exception instanceof RetailChainInUseError) return { status: 409, message: 'Cannot delete a retail chain while a store still uses it.' };
  if (exception instanceof ReceiptNotReadyError) return { status: 409, message: 'This receipt is not saved as purchases yet.' };
  if (exception instanceof ReceiptMigratedError) return { status: 409, message: 'This bill is already saved as purchases.' };

  return null;
}
