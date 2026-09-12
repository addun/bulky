import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DuplicateError } from '../domain/errors';
import { RECEIPT_SOURCE_BIEDRONKA } from '../domain/types';
import { billFromBiedronka, billSlipText, type Tx } from '../ocr/biedronka';
import { previewJPEG, previewText } from '../ocr/format';
import { marshalBill } from '../ocr/types';
import { StoreService } from '../store/store.service';
import { ReceiptImagesService } from './receipt-images';
import { ViewsService } from './views.service';

const biedronkaAPIBase = 'https://api.prod.biedronka.cloud/api/v7';
const biedronkaTokenURL = 'https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/token';
const biedronkaAPIUA = 'Android/2.22.2';
const biedronkaAuthUA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const biedronkaClientID = 'cma20';
const biedronkaRedirect = 'app://cma20.biedronka.pl';
const biedronkaMaxBody = 5 << 20;

@Controller()
export class BiedronkaController {
  private readonly biedronkaAPI = biedronkaAPIBase;
  private readonly biedronkaAuth = biedronkaTokenURL;

  constructor(
    private readonly store: StoreService,
    private readonly views: ViewsService,
    private readonly images: ReceiptImagesService,
  ) {}

  @Get('imports/biedronka')
  biedronka(@Res() res: Response): void {
    const state = this.biedronkaImportedState();
    let raw: string;
    try {
      raw = JSON.stringify(state);
    } catch {
      raw = '{"ids":[],"since":""}';
    }
    this.views.html(res, 'biedronka', 200, {
      Page: this.views.page('Biedronka', '', ''),
      ImportedJSON: raw,
    });
  }

  @Get('api/biedronka/imported')
  biedronkaImported(@Res() res: Response): void {
    res.json(this.biedronkaImportedState());
  }

  @Post('api/biedronka/import')
  async biedronkaImport(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = String(req.headers.authorization ?? '').trim();
    if (auth === '') {
      res.status(401).json({ error: 'missing token' });
      return;
    }
    const body = req.body as BiedronkaImportReq | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid bill' });
      return;
    }
    const idCheck = biedronkaTxID(String(body.id ?? ''));
    if (!idCheck) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const id = idCheck;
    const receiptJSON = receiptPayload(body.receipt);
    if (receiptJSON.length === 0 || receiptJSON.toString('utf8') === 'null') {
      res.status(400).json({ error: 'missing e-receipt' });
      return;
    }
    const tx: Tx = {
      ID: id,
      Date: String(body.date ?? ''),
      StoreName: String(body.store_name ?? ''),
      ReceiptNum: String(body.receipt_num ?? ''),
      TotalPrice: typeof body.total_price === 'number' ? body.total_price : Number(body.total_price) || 0,
    };
    let bill;
    try {
      bill = billFromBiedronka(receiptJSON, tx);
    } catch (err) {
      res.status(422).json({ error: err instanceof Error ? err.message : String(err), id });
      return;
    }
    let rawJSON: string;
    try {
      rawJSON = marshalBill(bill);
    } catch {
      res.status(500).json({ error: 'could not save the bill' });
      return;
    }
    const pdf = await this.fetchBiedronkaPDF(req, id, auth);
    let jpeg: Buffer;
    let src: Buffer;
    try {
      ({ jpeg, src } = await biedronkaPreview(pdf, bill, tx));
    } catch {
      res.status(422).json({ error: 'could not make a receipt image', id });
      return;
    }
    let imagePath: string;
    try {
      imagePath = await this.images.saveReceiptFiles(src, jpeg);
    } catch {
      res.status(500).json({ error: 'could not store the bill' });
      return;
    }
    let receipt;
    try {
      receipt = this.store.createSourcedReceipt(imagePath, RECEIPT_SOURCE_BIEDRONKA, id, receiptJSON.toString('utf8'));
    } catch (err) {
      await this.images.deleteReceiptFiles(imagePath);
      if (err instanceof DuplicateError) {
        res.status(200).json({ status: 'skipped', id });
        return;
      }
      res.status(500).json({ error: 'could not save the receipt' });
      return;
    }
    try {
      this.store.saveAIResponse(receipt.ID, rawJSON);
    } catch {
      res.status(500).json({ error: 'could not save the bill' });
      return;
    }
    res.status(200).json({ status: 'imported', id, receipt_id: receipt.ID });
  }

  @Get('api/biedronka/transactions')
  async biedronkaTransactions(@Req() req: Request, @Res() res: Response): Promise<void> {
    let page = String(req.query.page ?? '').trim();
    if (page === '') page = '1';
    const n = Number.parseInt(page, 10);
    if (!Number.isFinite(n) || n < 1) {
      res.status(400).json({ error: 'invalid page' });
      return;
    }
    await this.proxyBiedronka(req, res, 'GET', this.biedronkaAPIURL('transactions/'), { page: String(n) }, null, null);
  }

  @Get('api/biedronka/transactions/:id/e-receipt')
  async biedronkaEReceipt(@Req() req: Request, @Res() res: Response): Promise<void> {
    const id = biedronkaTxID(String(req.params.id ?? ''));
    if (!id) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const format = biedronkaOutputFormat(String(req.query.format ?? ''));
    if (!format) {
      res.status(400).json({ error: 'invalid format' });
      return;
    }
    const extra: Record<string, string> = { 'output-format': format };
    if (format === 'pdf') extra.Accept = 'application/pdf';
    await this.proxyBiedronka(req, res, 'GET', this.biedronkaAPIURL('transactions/' + id + '/e-receipt/'), null, extra, null);
  }

  @Get('api/biedronka/transactions/:id')
  async biedronkaTransaction(@Req() req: Request, @Res() res: Response): Promise<void> {
    const id = biedronkaTxID(String(req.params.id ?? ''));
    if (!id) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    await this.proxyBiedronka(req, res, 'GET', this.biedronkaAPIURL('transactions/' + id + '/'), null, null, null);
  }

  @Post('api/biedronka/token')
  async biedronkaToken(@Req() req: Request, @Res() res: Response): Promise<void> {
    let inn: BiedronkaTokenReq;
    try {
      inn = parseBiedronkaTokenReq(req);
    } catch {
      res.status(400).json({ error: 'invalid token request' });
      return;
    }
    let grant = inn.GrantType.trim();
    if (grant === '') grant = 'refresh_token';
    const form = new URLSearchParams();
    form.set('client_id', biedronkaClientID);
    form.set('redirect_uri', biedronkaRedirect);
    switch (grant) {
      case 'refresh_token': {
        const refresh = inn.RefreshToken.trim();
        if (refresh === '') {
          res.status(400).json({ error: 'refresh_token is required' });
          return;
        }
        form.set('grant_type', 'refresh_token');
        form.set('refresh_token', refresh);
        break;
      }
      case 'authorization_code': {
        const code = biedronkaAuthCode(inn.Code);
        if (!code) {
          res.status(400).json({ error: 'missing auth code' });
          return;
        }
        const verifier = inn.CodeVerifier.trim();
        if (verifier === '') {
          res.status(400).json({ error: 'code_verifier is required' });
          return;
        }
        form.set('grant_type', 'authorization_code');
        form.set('code', code);
        form.set('code_verifier', verifier);
        break;
      }
      default:
        res.status(400).json({ error: 'unsupported grant' });
        return;
    }
    await this.proxyBiedronka(
      req,
      res,
      'POST',
      this.biedronkaAuthURL(),
      null,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': biedronkaAuthUA,
      },
      form.toString(),
    );
  }

  private biedronkaImportedState(): { ids: string[]; since: string } {
    let ids: string[];
    try {
      ids = this.store.listReceiptExternalIDs(RECEIPT_SOURCE_BIEDRONKA);
    } catch {
      ids = [];
    }
    if (!ids) ids = [];
    const since = this.store.latestSourcedBoughtOn(RECEIPT_SOURCE_BIEDRONKA);
    return { ids, since };
  }

  private async fetchBiedronkaPDF(req: Request, id: string, auth: string): Promise<Buffer> {
    try {
      const { status, payload } = await this.biedronkaDo(
        req,
        'GET',
        this.biedronkaAPIURL('transactions/' + id + '/e-receipt/'),
        null,
        { 'output-format': 'pdf', Accept: 'application/pdf' },
        null,
        auth,
      );
      if (status < 200 || status >= 300) return Buffer.alloc(0);
      return payload;
    } catch {
      return Buffer.alloc(0);
    }
  }

  private async proxyBiedronka(
    req: Request,
    res: Response,
    method: string,
    rawURL: string,
    query: Record<string, string> | null,
    extra: Record<string, string> | null,
    body: string | null,
  ): Promise<void> {
    let auth = String(req.headers.authorization ?? '').trim();
    if (method !== 'POST' && auth === '') {
      res.status(401).json({ error: 'missing token' });
      return;
    }
    if (method === 'POST') auth = '';
    try {
      const { status, contentType, payload } = await this.biedronkaDo(req, method, rawURL, query, extra, body, auth);
      res.status(status).type(contentType).send(payload);
    } catch {
      res.status(502).json({ error: 'could not reach Biedronka' });
    }
  }

  private async biedronkaDo(
    _req: Request,
    method: string,
    rawURL: string,
    query: Record<string, string> | null,
    extra: Record<string, string> | null,
    body: string | null,
    auth: string,
  ): Promise<{ status: number; contentType: string; payload: Buffer }> {
    const parsed = new URL(rawURL);
    if (query) {
      parsed.search = new URLSearchParams(query).toString();
    }
    const headers = new Headers();
    headers.set('User-Agent', biedronkaAPIUA);
    headers.set('Accept-Language', 'pl-PL');
    headers.set('Accept', 'application/json');
    if (auth !== '') headers.set('Authorization', auth);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    }
    const resp = await fetch(parsed.toString(), {
      method,
      headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = Buffer.from(await resp.arrayBuffer());
    if (payload.length > biedronkaMaxBody) throw new Error('response too large');
    let ct = resp.headers.get('content-type') ?? '';
    if (ct === '') ct = 'application/json';
    return { status: resp.status, contentType: ct, payload };
  }

  private biedronkaAPIURL(path: string): string {
    let base = this.biedronkaAPI.replace(/\/+$/, '');
    if (base === '') base = biedronkaAPIBase;
    return base + '/' + path.replace(/^\/+/, '');
  }

  private biedronkaAuthURL(): string {
    return this.biedronkaAuth || biedronkaTokenURL;
  }
}

type BiedronkaImportReq = {
  id?: string;
  date?: string;
  store_name?: string;
  receipt_num?: string;
  total_price?: number;
  receipt?: unknown;
};

type BiedronkaTokenReq = {
  GrantType: string;
  RefreshToken: string;
  Code: string;
  CodeVerifier: string;
};

function receiptPayload(receipt: unknown): Buffer {
  if (receipt == null) return Buffer.from('null');
  if (typeof receipt === 'string') return Buffer.from(receipt.trim());
  if (Buffer.isBuffer(receipt)) return receipt;
  return Buffer.from(JSON.stringify(receipt));
}

function parseBiedronkaTokenReq(req: Request): BiedronkaTokenReq {
  const ct = String(req.headers['content-type'] ?? '');
  if (ct.includes('json')) {
    const inBody = req.body as Record<string, unknown> | undefined;
    if (!inBody || typeof inBody !== 'object') throw new Error('invalid token request');
    return {
      GrantType: String(inBody.grant_type ?? ''),
      RefreshToken: String(inBody.refresh_token ?? ''),
      Code: String(inBody.code ?? ''),
      CodeVerifier: String(inBody.code_verifier ?? ''),
    };
  }
  return {
    GrantType: String((req.body as Record<string, unknown> | undefined)?.grant_type ?? ''),
    RefreshToken: String((req.body as Record<string, unknown> | undefined)?.refresh_token ?? ''),
    Code: String((req.body as Record<string, unknown> | undefined)?.code ?? ''),
    CodeVerifier: String((req.body as Record<string, unknown> | undefined)?.code_verifier ?? ''),
  };
}

function biedronkaAuthCode(value: string): string | null {
  let raw = value.trim();
  raw = raw.replace(/^["']+|["']+$/g, '');
  if (raw === '') return null;
  const app = raw.indexOf('app://');
  if (app >= 0) {
    raw = raw.slice(app);
    const end = raw.search(/[ \t\n\r]/);
    if (end >= 0) raw = raw.slice(0, end);
    raw = raw.replace(/[.,;"']+$/g, '');
  }
  if (raw.includes('://') || raw.startsWith('app:') || raw.includes('code=')) {
    return biedronkaCodeFromRedirect(raw);
  }
  return raw;
}

function biedronkaCodeFromRedirect(raw: string): string | null {
  try {
    const u = new URL(raw);
    let code = u.searchParams.get('code')?.trim() ?? '';
    if (code === '' && u.hash) {
      const fq = new URLSearchParams(u.hash.replace(/^#/, ''));
      code = fq.get('code')?.trim() ?? '';
    }
    return code === '' ? null : code;
  } catch {
    return null;
  }
}

function biedronkaOutputFormat(raw: string): string | null {
  switch (raw.toLowerCase().trim()) {
    case '':
    case 'json':
      return 'json';
    case 'pdf':
      return 'pdf';
    default:
      return null;
  }
}

function biedronkaTxID(raw: string): string | null {
  const id = raw.trim();
  if (id === '' || id.length > 128) return null;
  for (const r of id) {
    if (/[\p{L}\p{N}]/u.test(r) || r === '-' || r === '_') continue;
    return null;
  }
  return id;
}

async function biedronkaPreview(
  pdf: Buffer,
  bill: ReturnType<typeof billFromBiedronka>,
  tx: Tx,
): Promise<{ jpeg: Buffer; src: Buffer }> {
  if (pdf.length > 0) {
    try {
      const jpeg = await previewJPEG(pdf);
      return { jpeg, src: pdf };
    } catch {
      /* fall through */
    }
  }
  const jpeg = await previewText(billSlipText(bill, tx));
  return { jpeg, src: jpeg };
}
