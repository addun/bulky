import { Catch, ExceptionFilter, ArgumentsHost, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

@Catch(BadRequestException)
export class HtmlExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    res.status(400).json(typeof body === 'string' ? { error: body } : body);
  }
}
