const AUTH_URL = 'https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/auth';
const API = '/api/biedronka';
const TOKEN = '/api/biedronka/token';
const CLIENT_ID = 'cma20';
const REDIRECT = 'app://cma20.biedronka.pl';

export const HINT_HELPER =
  'The Chromium helper fills this field after Moja Biedronka sign-in. Click Finish sign-in to continue. The code works once and expires in about a minute.';
export const HINT_PASTE =
  'After SMS (or if you are already signed in), the login tries to open app://cma20.biedronka.pl?code=…. Paste that address here. To fill it automatically, load the unpacked helper from extensions/biedronka (Chrome, Edge, Brave, or Arc), then refresh. The helper matches localhost:5173, 127.0.0.1:5173, localhost:3000, shop.home.arpa, and shop.piekna2.pl. The code works once and expires in about a minute.';

export type BiedronkaTx = {
  id?: string;
  date?: string;
  store_name?: string;
  receipt_num?: string;
  total_price?: number;
  receipt?: unknown;
  source?: string;
  bulkly_status?: string;
  bulkly_error?: string;
  receipt_id?: number;
};

export class BiedronkaImport {
  signedIn = $state(false);
  session = $state('');
  status = $state('');
  helper = $state(false);
  rows = $state<BiedronkaTx[]>([]);
  results = $state(false);
  empty = $state('');
  more = $state(false);
  busy = $state(false);
  importing = $state(false);
  importable = $state(0);

  #access = '';
  #refresh = '';
  #pkce = '';
  #imported: Record<string, true> = {};
  #finishing = false;
  #loading = false;
  #page = 1;
  #archived = false;

  constructor() {
    try {
      localStorage.removeItem('bulkly.biedronka.tokens');
      this.#pkce = sessionStorage.getItem('bulkly.biedronka.pkce') || '';
    } catch {
      this.#pkce = '';
    }
  }

  async loadImported(): Promise<void> {
    try {
      const res = await fetch(`${API}/imported`);
      if (!res.ok) return;
      const data = (await res.json()) as { ids?: string[] };
      for (const id of data.ids ?? []) {
        if (id) this.#imported[id] = true;
      }
      if (this.rows.length) this.rows = [...this.rows];
      this.#syncImportAll();
    } catch {
      /* the list still works without previously imported ids */
    }
  }

  setHelper(on: boolean): void {
    this.helper = on;
  }

  redirectFilled(): void {
    this.status = 'The helper filled the redirect. Click Finish sign-in.';
  }

  async startSignIn(): Promise<string> {
    const pkce = await generatePkce();
    this.#pkce = pkce.verifier;
    try {
      sessionStorage.setItem('bulkly.biedronka.pkce', pkce.verifier);
    } catch {
      /* session storage can be blocked */
    }
    this.status = this.helper
      ? 'Sign in in the Biedronka tab. The helper will fill the redirect here.'
      : 'Sign in in the Biedronka tab, then paste the app:// redirect here.';
    return authorizationURL(pkce.challenge);
  }

  popupBlocked(): void {
    this.status = this.helper
      ? 'Popup blocked. Allow popups for this page, then click Sign in again. The helper will fill the redirect here.'
      : 'Popup blocked. Allow popups for this page, then click Sign in again and paste the app:// redirect here.';
  }

  async finishSignIn(raw: string): Promise<'ok' | 'keep' | 'clear'> {
    if (this.#finishing) return 'keep';
    if (!this.#pkce) {
      this.status = 'Start sign-in again so this page still has the PKCE verifier.';
      return 'keep';
    }
    let code: string;
    try {
      code = authCodeFromRedirect(raw);
    } catch (err) {
      this.status = messageOf(err);
      return 'keep';
    }
    this.#finishing = true;
    this.busy = true;
    try {
      const next = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: this.#pkce,
      });
      if (!next.access_token) throw new Error('token rejected');
      this.#pkce = '';
      try {
        sessionStorage.removeItem('bulkly.biedronka.pkce');
      } catch {
        /* ignore */
      }
      this.#save(next);
      this.#showSession();
      this.status = 'Signed in. Loading bills…';
      await this.loadBills(true);
      return 'ok';
    } catch (err) {
      this.status = messageOf(err);
      return 'clear';
    } finally {
      this.#finishing = false;
      this.busy = false;
    }
  }

  signOut(): void {
    this.#access = '';
    this.#refresh = '';
    this.#pkce = '';
    try {
      sessionStorage.removeItem('bulkly.biedronka.pkce');
    } catch {
      /* ignore */
    }
    this.#page = 1;
    this.rows = [];
    this.results = false;
    this.#showSession();
    this.status = 'Signed out.';
    this.#syncImportAll();
  }

  async loadBills(reset: boolean): Promise<void> {
    if (this.#loading) return;
    if (!this.#access && !this.#refresh) {
      this.status = 'Sign in with Moja Biedronka first.';
      return;
    }
    this.#loading = true;
    this.busy = true;
    try {
      await this.#ensureFresh();
      if (reset) {
        this.#page = 1;
        this.#archived = false;
        this.rows = [];
      }
      this.status = `Loading page ${this.#page}…`;
      const query: Record<string, string> = { page: String(this.#page) };
      if (this.#archived) query.archived = '1';
      const payload = (await this.#apiGet('transactions/', query)) as {
        page_count?: number;
        transactions?: BiedronkaTx[];
        results?: BiedronkaTx[];
        next_page?: number;
      };
      const pageCount = Math.max(1, Number(payload.page_count) || this.#page);
      const batch = Array.isArray(payload.transactions)
        ? payload.transactions
        : Array.isArray(payload.results)
          ? payload.results
          : [];
      console.info('[biedronka]', 'listed', this.#archived ? 'archived' : 'current', 'page', this.#page, 'of', pageCount, `${batch.length} bills`);
      this.rows = [...this.rows, ...batch];
      const fromArchive = this.#archived;
      const next = Number(payload.next_page);
      if (next && next > this.#page) this.#page = next;
      else if (!this.#archived) {
        this.#archived = true;
        this.#page = 1;
      } else this.#page = 0;
      const n = this.rows.length;
      this.empty = !n
        ? fromArchive
          ? 'No older bills.'
          : 'No current bills from the last 12 days. Load more for older bills.'
        : '';
      this.results = true;
      this.more = this.#page > 0;
      this.status = n ? `${n} bill${n === 1 ? '' : 's'} loaded.` : '';
    } catch (err) {
      this.status = messageOf(err);
    } finally {
      this.#loading = false;
      this.busy = false;
      this.#syncImportAll();
    }
  }

  label(tx: BiedronkaTx): string {
    if (!tx.id) return '';
    if (tx.bulkly_status === 'imported') return 'imported';
    if (tx.bulkly_status === 'skipped') return 'already in';
    if (tx.bulkly_error) return tx.bulkly_error;
    if (this.#imported[tx.id]) return 'already in';
    return '';
  }

  canImport(tx: BiedronkaTx): boolean {
    return Boolean(tx.id && !this.#imported[tx.id] && tx.bulkly_status !== 'imported' && tx.bulkly_status !== 'skipped');
  }

  async importOne(tx: BiedronkaTx): Promise<void> {
    if (this.importing || this.#loading || !this.canImport(tx)) return;
    this.importing = true;
    this.#syncImportAll();
    this.status = 'Importing…';
    try {
      tx.bulkly_error = '';
      await this.#ensureFresh();
      await this.#ensureReceipt(tx);
      await this.#postImport(tx);
      this.status = tx.bulkly_status === 'skipped' ? 'Already in receipts.' : 'Imported. Open Receipts to edit products or the visit.';
    } catch (err) {
      tx.bulkly_error = messageOf(err);
      console.info('[biedronka]', tx.id, 'import failed:', tx.bulkly_error);
      this.status = tx.bulkly_error;
    }
    this.importing = false;
    this.rows = [...this.rows];
    this.#syncImportAll();
  }

  async importAll(): Promise<void> {
    if (this.importing || this.#loading) return;
    const todo = this.rows.filter((tx) => this.canImport(tx)).length;
    if (!todo) {
      this.status = 'Nothing new to import.';
      this.#syncImportAll();
      return;
    }
    this.importing = true;
    this.#syncImportAll();
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    try {
      await this.#ensureFresh();
      for (const tx of this.rows) {
        if (!this.canImport(tx)) {
          if (tx.id && this.#imported[tx.id]) skipped++;
          continue;
        }
        this.status = `Importing ${imported + skipped + failed + 1} of ${todo}…`;
        try {
          await this.#ensureReceipt(tx);
          await this.#postImport(tx);
          if (tx.bulkly_status === 'skipped') skipped++;
          else imported++;
        } catch (err) {
          tx.bulkly_error = messageOf(err);
          failed++;
          console.info('[biedronka]', tx.id, 'import failed:', tx.bulkly_error);
        }
      }
      const parts: string[] = [];
      if (imported) parts.push(`imported ${imported}`);
      if (skipped) parts.push(`skipped ${skipped}`);
      if (failed) parts.push(`failed ${failed}`);
      this.status = `${parts.join(', ')}. Open Receipts to edit products or the visit.`;
    } finally {
      this.importing = false;
      this.rows = [...this.rows];
      this.#syncImportAll();
    }
  }

  #showSession(): void {
    this.signedIn = Boolean(this.#access || this.#refresh);
    if (!this.signedIn) {
      this.session = '';
      return;
    }
    const payload = jwtPayload(this.#access);
    this.session =
      typeof payload.exp === 'number'
        ? `Signed in · access token until ${new Date(payload.exp * 1000).toLocaleString('pl-PL')}`
        : 'Signed in.';
  }

  #save(next: { access_token?: string; refresh_token?: string }): void {
    if (next.access_token) this.#access = next.access_token;
    if (next.refresh_token) this.#refresh = next.refresh_token;
  }

  #syncImportAll(): void {
    this.importable = this.rows.filter((tx) => this.canImport(tx)).length;
  }

  async #ensureFresh(): Promise<void> {
    const payload = jwtPayload(this.#access);
    if (typeof payload.exp === 'number' && payload.exp - 60 > Date.now() / 1000) return;
    if (!this.#refresh) return;
    const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: this.#refresh });
    this.#save({ access_token: next.access_token, refresh_token: next.refresh_token || this.#refresh });
    this.#showSession();
  }

  async #ensureReceipt(tx: BiedronkaTx): Promise<void> {
    if (tx.receipt) return;
    this.status = `Loading receipt ${tx.receipt_num || tx.id}…`;
    const id = encodeURIComponent(String(tx.id));
    console.info('[biedronka]', tx.id, 'details');
    tx.receipt = await this.#apiGet(`transactions/${id}/`);
    tx.source = 'details';
    console.info('[biedronka]', tx.id, 'details ok');
  }

  async #postImport(tx: BiedronkaTx): Promise<void> {
    console.info('[biedronka]', 'POST import', tx.id, `source=${tx.source || ''}`);
    const out = (await this.#apiSend('import', {
      id: String(tx.id),
      date: tx.date || '',
      store_name: tx.store_name || '',
      receipt_num: tx.receipt_num || '',
      total_price: Number(tx.total_price) || 0,
      receipt: tx.receipt,
    })) as { status?: string; receipt_id?: number };
    if (out?.status === 'skipped') {
      tx.bulkly_status = 'skipped';
      if (tx.id) this.#imported[tx.id] = true;
      console.info('[biedronka]', tx.id, 'skipped duplicate');
      return;
    }
    tx.bulkly_status = 'imported';
    tx.receipt_id = out?.receipt_id;
    if (tx.id) this.#imported[tx.id] = true;
    console.info('[biedronka]', tx.id, `imported receipt_id=${out?.receipt_id}`);
  }

  async #apiGet(path: string, query?: Record<string, string>): Promise<unknown> {
    await this.#ensureFresh();
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const res = await fetch(`${API}/${path.replace(/\/$/, '')}${qs}`, {
      headers: {
        Authorization: `Bearer ${this.#access}`,
        Accept: 'application/json',
        'Accept-Language': 'pl-PL',
      },
    });
    return readJSON(res);
  }

  async #apiSend(path: string, body: unknown): Promise<unknown> {
    await this.#ensureFresh();
    const res = await fetch(`${API}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#access}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return readJSON(res);
  }
}

export function formatBillDate(raw: string | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('pl-PL');
}

export function formatBillMoney(n: number | undefined): string {
  if (n == null) return '';
  if (!Number.isFinite(n)) return String(n);
  return `${n.toFixed(2).replace('.', ',')} zł`;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function authorizationURL(challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function authCodeFromRedirect(value: string): string {
  let raw = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) throw new Error('missing auth code');
  const appIdx = raw.indexOf('app://');
  if (appIdx >= 0) raw = raw.slice(appIdx).split(/\s/)[0]?.replace(/[.,;"']+$/g, '') ?? '';
  if (raw.includes('://') || raw.startsWith('app:') || raw.includes('code=')) return codeFromRedirect(raw);
  return raw;
}

function codeFromRedirect(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('missing auth code');
  }
  let code = parsed.searchParams.get('code');
  if (!code && parsed.hash) code = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('code');
  if (!code) throw new Error('missing auth code');
  return code;
}

function jwtPayload(token: string): { exp?: number } {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return {};
  let padded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  try {
    return (JSON.parse(atob(padded)) as { exp?: number }) || {};
  } catch {
    return {};
  }
}

async function tokenRequest(fields: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string }> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, ...fields });
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  return (await readJSON(res)) as { access_token?: string; refresh_token?: string };
}

async function readJSON(res: Response): Promise<unknown> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new Error(tokenError(data, res.status));
  return data;
}

function tokenError(data: unknown, status: number): string {
  const record = data && typeof data === 'object' ? (data as { error?: unknown; error_description?: unknown }) : null;
  const desc = record?.error_description ? String(record.error_description) : '';
  const err = record?.error ? String(record.error) : '';
  if (err === 'invalid_grant' || /code not valid/i.test(desc)) {
    return 'That login code is expired or already used. Click Sign in again and finish SMS right away.';
  }
  if (desc) return desc;
  if (err) return err;
  if (typeof data === 'string' && data) return data.slice(0, 180);
  return `http ${status}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
