const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Rough HTML → plain text used for snippets, search bodies and text fallbacks. */
export function htmlToText(html: string): string {
  if (!html) return '';
  let text = html;
  text = text.replace(/<(script|style|head|title|noscript|template)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table|section|article|header|footer)>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    if (!label || label === href) return href;
    return `${label} (${href})`;
  });
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/[ \t\u00a0]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function makeSnippet(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + '…';
}

export function textToHtml(text: string): string {
  const escaped = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
    (url) => `<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>`,
  );
  return `<div style="white-space:pre-wrap;font-family:inherit">${escaped}</div>`;
}

const SUBJECT_PREFIX_RE = /^\s*((re|fw|fwd|aw|wg|sv|vs|tr|r)\s*(\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? '').replace(SUBJECT_PREFIX_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function replySubject(subject: string): string {
  const s = subject.trim();
  return /^\s*re\s*:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string): string {
  const s = subject.trim();
  return /^\s*fwd?\s*:/i.test(s) ? s : `Fwd: ${s}`;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encoder.encode(value.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${idx === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[idx]}`;
}
