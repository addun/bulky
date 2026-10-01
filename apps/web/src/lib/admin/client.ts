import { error, fail } from '@sveltejs/kit';

export type ApiFailure = { ok: false; status: number; message: string; body: Record<string, unknown> };
export type ApiSuccess<T> = { ok: true; status: number; data: T };

function origin(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_ORIGIN || (import.meta.env.DEV ? 'http://127.0.0.1:8080' : '');
}

export async function apiGet<T>(path: string): Promise<T> {
  const result = await apiSend<T>('GET', path);
  if (!result.ok) error(result.status === 404 ? 404 : result.status, result.message);
  return result.data;
}

export async function apiSend<T>(
  method: string,
  path: string,
  init?: { json?: unknown; form?: FormData },
): Promise<ApiSuccess<T> | ApiFailure> {
  const headers = new Headers();
  let body: BodyInit | undefined;
  if (init?.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  } else if (init?.form) {
    body = init.form;
  }
  let res: Response;
  try {
    res = await fetch(`${origin()}${path}`, { method, headers, body });
  } catch {
    error(503, 'API is unavailable.');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { message?: string; error?: string }) : ({} as T);
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && data.message) ||
      (data && typeof data === 'object' && 'error' in data && data.error) ||
      'Request failed.';
    return { ok: false, status: res.status, message: String(message), body: (data && typeof data === 'object' ? data : {}) as Record<string, unknown> };
  }
  return { ok: true, status: res.status, data: data as T };
}

export function multipart(form: FormData): FormData {
  const out = new FormData();
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      if (value.size > 0) out.append(key, value, value.name);
    } else out.append(key, value);
  }
  return out;
}

export function formJson(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (value instanceof File) continue;
    const current = out[key];
    if (current === undefined) out[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else out[key] = [current, value];
  }
  return out;
}

export function formText(form: Record<string, unknown>, key: string): string {
  const value = form[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function formInt(form: Record<string, unknown>, key: string): number {
  const value = form[key];
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function formInts(form: Record<string, unknown>, key: string): number[] {
  const value = form[key];
  const items = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return items.map((item) => Number.parseInt(String(item), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

export function formCoord(form: Record<string, unknown>, key: string): number | string | null {
  const raw = formText(form, key).trim().replace(',', '.');
  if (raw === '') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : raw;
}

export function rejected(status: number, message: string, extra: Record<string, unknown> = {}) {
  return fail(status, { message, ...extra });
}
