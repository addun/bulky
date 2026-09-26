export function nowRFC3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
