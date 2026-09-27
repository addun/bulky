import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { viewData } from './helpers.js';
import { makePage, type Page } from './present.js';

@Injectable()
export class ViewsService {
  readonly symbol: string;
  readonly currency: string;

  constructor(config: ConfigService) {
    this.symbol = config.get<string>('CURRENCY_SYMBOL') || 'zł';
    this.currency = config.get<string>('CURRENCY') || 'PLN';
  }

  page(title: string, query: string, errMsg: string, refreshSeconds = 0): Page {
    return makePage(title, query, errMsg, this.symbol, this.currency, false, refreshSeconds);
  }

  adminPage(title: string, query: string, errMsg: string, refreshSeconds = 0): Page {
    return makePage(title, query, errMsg, this.symbol, this.currency, true, refreshSeconds);
  }

  html(res: Response, template: string, status: number, data: Record<string, unknown>): void {
    res.status(status).render(template, viewData(data));
  }

  text(res: Response, status: number, body: string): void {
    res.status(status).type('text/plain').send(body);
  }

  redirect(res: Response, path: string): void {
    res.redirect(303, path);
  }

  viewsDir(): string {
    return join(import.meta.dirname, '..', '..', 'views');
  }
}
