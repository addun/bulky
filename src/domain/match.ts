export type Label = {
  productID: number;
  text: string;
};

const foldPolish: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

const MIN_SEARCH_SCORE = 0.85;
const CONTAIN_SCORE = 0.92;

export function matchProduct(
  query: string,
  shop: Label[],
  chain: Label[],
  global: Label[],
  names: Label[],
): { id: number; ok: boolean } {
  if (query.trim() === '') return { id: 0, ok: false };
  for (const pool of [shop, chain, global]) {
    const { id, result } = exactPool(query, pool, true);
    if (result === 'hit') return { id, ok: true };
    if (result === 'ambiguous') return { id: 0, ok: false };
  }
  const named = exactPool(query, names, false);
  if (named.result === 'hit') return { id: named.id, ok: true };
  if (named.result === 'ambiguous') return { id: 0, ok: false };
  return { id: 0, ok: false };
}

function exactPool(
  query: string,
  labels: Label[],
  ignoreSpaces: boolean,
): { id: number; result: 'none' | 'hit' | 'ambiguous' } {
  const q = normalize(query, ignoreSpaces);
  if (q === '') return { id: 0, result: 'none' };
  const matched = new Set<number>();
  for (const lab of labels) {
    if (normalize(lab.text, ignoreSpaces) === q) matched.add(lab.productID);
  }
  if (matched.size === 0) return { id: 0, result: 'none' };
  if (matched.size === 1) return { id: [...matched][0]!, result: 'hit' };
  return { id: 0, result: 'ambiguous' };
}

function normalize(s: string, ignoreSpaces: boolean): string {
  return fold(ignoreSpaces ? s.replace(/\s+/gu, '') : s);
}

export function fold(s: string): string {
  let out = '';
  let prevSpace = true;
  for (const ch of s) {
    let r = ch.toLowerCase();
    if (foldPolish[r]) r = foldPolish[r]!;
    if (/[\p{L}\p{N}]/u.test(r)) {
      out += r;
      prevSpace = false;
      continue;
    }
    if (!prevSpace) {
      out += ' ';
      prevSpace = true;
    }
  }
  return out.trim();
}

export function search(query: string, ...labels: string[]): number {
  const q = fold(query);
  if (q === '') return 0;
  let best = 0;
  for (const label of labels) {
    const s = searchScore(q, fold(label));
    if (s > best) best = s;
  }
  return best;
}

function searchScore(q: string, l: string): number {
  if (l === '') return 0;
  if (q === l) return 1;
  if (l.includes(q)) return substringScore(q, l);
  let best = similarity(q, l);
  for (const tok of l.split(/\s+/)) {
    const s = similarity(q, tok);
    if (s > best) best = s;
  }
  for (const qt of q.split(/\s+/)) {
    if (qt === l || l.includes(qt)) {
      if (CONTAIN_SCORE > best) best = CONTAIN_SCORE;
      continue;
    }
    for (const tok of l.split(/\s+/)) {
      const s = similarity(qt, tok);
      if (s > best) best = s;
    }
  }
  if (best < MIN_SEARCH_SCORE) return 0;
  return best;
}

function substringScore(q: string, l: string): number {
  const nl = [...l].length;
  if (nl === 0) return 0;
  let cover = [...q].length / nl;
  if (cover > 1) cover = 1;
  return CONTAIN_SCORE + (1 - CONTAIN_SCORE) * cover;
}

function similarity(a: string, b: string): number {
  const d = levenshtein(a, b);
  let n = [...a].length;
  const m = [...b].length;
  if (m > n) n = m;
  if (n === 0) return 1;
  return 1 - d / n;
}

function levenshtein(a: string, b: string): number {
  const ar = [...a];
  const br = [...b];
  if (ar.length === 0) return br.length;
  if (br.length === 0) return ar.length;
  let prev = Array.from({ length: br.length + 1 }, (_, j) => j);
  let cur = Array.from({ length: br.length + 1 }, () => 0);
  for (let i = 0; i < ar.length; i++) {
    cur[0] = i + 1;
    for (let j = 0; j < br.length; j++) {
      const cost = ar[i] === br[j] ? 0 : 1;
      let del = prev[j + 1]! + 1;
      const ins = cur[j]! + 1;
      const sub = prev[j]! + cost;
      if (ins < del) del = ins;
      if (sub < del) del = sub;
      cur[j + 1] = del;
    }
    [prev, cur] = [cur, prev];
  }
  return prev[br.length]!;
}
