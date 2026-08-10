const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

export function sanitizeText(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  let out = input.replace(TAG_RE, '').replace(CONTROL_RE, '');
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return out.slice(0, maxLength).trim();
}

export function sanitizeName(input, maxLength = 20) {
  if (typeof input !== 'string') return '';
  let out = input.replace(TAG_RE, '').replace(CONTROL_RE, '');
  out = out.replace(/[^\p{L}\p{N} _\-\u0400-\u04FF]/gu, '');
  return out.slice(0, maxLength).trim();
}

export function isSafeId(id, maxLength = 64) {
  return typeof id === 'string' && id.length > 0 && id.length <= maxLength && /^[a-zA-Z0-9_-]+$/.test(id);
}
