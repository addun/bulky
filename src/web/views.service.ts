import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { viewData } from './helpers';
import { makePage, type Page } from './present';

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

  paramID(req: Request, name: string): number | null {
    const id = Number.parseInt(String(req.params[name] ?? ''), 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
  }

  formInt(req: Request, name: string): number {
    const raw = String(this.field(req, name) ?? '').trim();
    const v = Number.parseInt(raw, 10);
    return Number.isFinite(v) ? v : 0;
  }

  formInts(req: Request, name: string): number[] {
    const raw = this.fields(req, name);
    const out: number[] = [];
    for (const s of raw) {
      const v = Number.parseInt(s.trim(), 10);
      if (Number.isFinite(v) && v > 0) out.push(v);
    }
    return out;
  }

  queryInt(req: Request, name: string): number {
    const v = Number.parseInt(String(req.query[name] ?? '').trim(), 10);
    return Number.isFinite(v) ? v : 0;
  }

  field(req: Request, name: string): string {
    const body = req.body as Record<string, unknown> | undefined;
    const v = body?.[name];
    if (Array.isArray(v)) return String(v[0] ?? '');
    return v === undefined || v === null ? '' : String(v);
  }

  fields(req: Request, name: string): string[] {
    const body = req.body as Record<string, unknown> | undefined;
    const v = body?.[name];
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.map(String);
    return [String(v)];
  }

  viewsDir(): string {
    return join(__dirname, '..', '..', 'views');
  }
}
