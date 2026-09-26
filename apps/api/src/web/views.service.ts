import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
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

  json(res: Response, status: number, data: Record<string, unknown>): void {
    res.status(status).json(data);
  }

  text(res: Response, status: number, body: string): void {
    res.status(status).json({ error: body });
  }

  redirect(res: Response, path: string): void {
    res.status(200).json({ location: path });
  }
}
