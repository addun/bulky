import { Controller, Get, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DuplicateError, InvalidStoreError, InvalidUnitError } from '../domain/errors.js';
import { billFromBiedronka, type BiedronkaTx } from '../imports/biedronka.js';
import { biedronkaReceipt } from '../imports/biedronka.schema.js';
import { marshalBill } from '../ocr/types.js';
import { AliasesRepository } from '#app/store/aliases';
import { LocationsRepository } from '#app/store/locations';
import { ProductsRepository } from '#app/store/products';
import { RECEIPT_SOURCE_BIEDRONKA, ReceiptsRepository } from '#app/store/receipts';
import { UnitsRepository } from '#app/store/units';
import { billToImport, hydrateBill, matchStore, storeChainID } from './receipt-form.js';
import { ViewsService } from './views.service.js';
import { biedronkaImportBody, biedronkaPageQuery, biedronkaTokenBody, biedronkaTxId, formIssue } from './schema.js';

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
  private readonly log = new Logger('Biedronka');
  private readonly biedronkaAPI = biedronkaAPIBase;
  private readonly biedronkaAuth = biedronkaTokenURL;

  constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly views: ViewsService,
    private readonly products: ProductsRepository,
    private readonly aliases: AliasesRepository,
    private readonly locations: LocationsRepository,
    private readonly units: UnitsRepository,
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
      page: this.views.page('Biedronka', '', ''),
      importedJSON: raw,
    });
  }

  @Get('api/biedronka/imported')
  biedronkaImported(@Res() res: Response): void {
    res.json(this.biedronkaImportedState());
  }

  @Post('api/biedronka/import')
  biedronkaImport(@Req() req: Request, @Res() res: Response): void {
    const auth = String(req.headers.authorization ?? '').trim();
    if (auth === '') {
      res.status(401).json({ error: 'missing token' });
      return;
    }
    const parsed = biedronkaImportBody.safeParse(req.body);
    if (!parsed.success) {
      const idIssue = parsed.error.issues.some((issue) => issue.path[0] === 'id');
      res.status(400).json({ error: idIssue ? 'invalid id' : 'invalid bill' });
      return;
    }
    const body = parsed.data;
    const id = body.id;
    const tx: BiedronkaTx = {
      id,
      date: body.date,
      store_name: body.store_name,
      receipt_num: body.receipt_num,
      total_price: body.total_price,
    };
    const receiptJSON = receiptPayload(body.receipt);
    const kind = receiptKind(body.receipt);
    this.log.log(`import ${id}: ${tx.date} ${tx.store_name} ${tx.total_price} kind=${kind}`);
    let bill;
    try {
      bill = billFromBiedronka(body.receipt, tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`import ${id}: bill failed (${kind}): ${msg}`);
      res.status(422).json({ error: msg, id });
      return;
    }
    this.log.log(`import ${id}: ${bill.lines.length} lines`);
    try {
      const products = this.products.listProducts('');
      const stores = this.locations.listStores();
      const aliases = this.aliases.listAliases();
      const defaults = this.units.unitDefaults();
      if (bill.storeId === 0) bill.storeId = matchStore(bill, stores);
      bill = hydrateBill(bill, products, aliases, storeChainID(bill.storeId, stores), defaults.pieceId, defaults.weightId);
    } catch (err) {
      this.log.warn(`import ${id}: catalog failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'could not load the catalog', id });
      return;
    }
    let inn;
    try {
      inn = billToImport(bill);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`import ${id}: import lines failed: ${msg}`);
      res.status(422).json({ error: msg, id });
      return;
    }
    if (inn.lines.length === 0) {
      this.log.warn(`import ${id}: no product lines`);
      res.status(422).json({ error: 'no products found on this bill', id });
      return;
    }
    let rawJSON: string;
    try {
      rawJSON = marshalBill(bill);
    } catch {
      this.log.warn(`import ${id}: could not marshal bill`);
      res.status(500).json({ error: 'could not save the bill' });
      return;
    }
    let receipt;
    let purchases = 0;
    try {
      const out = this.receipts.importTrustedReceipt(
        null,
        RECEIPT_SOURCE_BIEDRONKA,
        id,
        receiptJSON.toString('utf8'),
        inn,
        rawJSON,
      );
      receipt = out.receipt;
      purchases = out.result.purchases;
    } catch (err) {
      if (err instanceof DuplicateError) {
        this.log.log(`import ${id}: skipped duplicate`);
        res.status(200).json({ status: 'skipped', id });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof InvalidUnitError) {
        this.log.warn(`import ${id}: missing unit defaults`);
        res.status(422).json({ error: 'Set piece and weight units under Settings, then import again.', id });
        return;
      }
      if (err instanceof InvalidStoreError) {
        this.log.warn(`import ${id}: store failed: ${msg}`);
        res.status(422).json({ error: 'could not save the store', id });
        return;
      }
      this.log.warn(`import ${id}: could not save the receipt: ${msg}`);
      res.status(500).json({ error: 'could not save the receipt' });
      return;
    }
    this.log.log(`import ${id}: imported receipt_id=${receipt.id} purchases=${purchases}`);
    res.status(200).json({ status: 'imported', id, receipt_id: receipt.id, purchases });
  }

  @Get('api/biedronka/transactions')
  async biedronkaTransactions(
    @Query({ schema: biedronkaPageQuery }) query: { page: number },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.proxyBiedronka(req, res, 'GET', this.biedronkaAPIURL('transactions/'), { page: String(query.page) }, null, null);
  }

  @Get('api/biedronka/transactions/:id')
  async biedronkaTransaction(
    @Param('id', { schema: biedronkaTxId }) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.proxyBiedronka(req, res, 'GET', this.biedronkaAPIURL('transactions/' + id + '/'), null, null, null);
  }

  @Post('api/biedronka/token')
  async biedronkaToken(@Req() req: Request, @Res() res: Response): Promise<void> {
    const inn = biedronkaTokenBody.safeParse(req.body);
    if (!inn.success) {
      res.status(400).json({ error: formIssue(inn.error) });
      return;
    }
    const grant = inn.data.grant_type;
    const form = new URLSearchParams();
    form.set('client_id', biedronkaClientID);
    form.set('redirect_uri', biedronkaRedirect);
    switch (grant) {
      case 'refresh_token': {
        form.set('grant_type', 'refresh_token');
        form.set('refresh_token', inn.data.refresh_token);
        break;
      }
      case 'authorization_code': {
        const code = biedronkaAuthCode(inn.data.code);
        if (!code) {
          res.status(400).json({ error: 'missing auth code' });
          return;
        }
        form.set('grant_type', 'authorization_code');
        form.set('code', code);
        form.set('code_verifier', inn.data.code_verifier);
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
      ids = this.receipts.listReceiptExternalIDs(RECEIPT_SOURCE_BIEDRONKA);
    } catch {
      ids = [];
    }
    if (!ids) ids = [];
    const since = this.receipts.latestSourcedBoughtOn(RECEIPT_SOURCE_BIEDRONKA);
    return { ids, since };
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
      this.log.warn(`proxy ${method} ${rawURL}: missing token`);
      res.status(401).json({ error: 'missing token' });
      return;
    }
    if (method === 'POST') auth = '';
    try {
      const { status, contentType, payload } = await this.biedronkaDo(req, method, rawURL, query, extra, body, auth);
      res.status(status).type(contentType).send(payload);
    } catch (err) {
      this.log.warn(`proxy ${method} ${rawURL} failed: ${err instanceof Error ? err.message : String(err)}`);
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
    this.log.log(`${method} ${parsed.pathname}${parsed.search} -> ${resp.status} ${payload.length}B`);
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

function receiptKind(receipt: unknown): string {
  if (biedronkaReceipt.safeParse(receipt).success) return 'details';
  if (Array.isArray(receipt)) return 'till';
  return 'other';
}

function receiptPayload(receipt: unknown): Buffer {
  if (receipt == null) return Buffer.from('null');
  if (typeof receipt === 'string') return Buffer.from(receipt.trim());
  if (Buffer.isBuffer(receipt)) return receipt;
  return Buffer.from(JSON.stringify(receipt));
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

