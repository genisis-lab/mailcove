import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'react';
import { escapeHtml } from '@shared/text';

type Props = {
  messageId: string;
  html: string | null;
  text: string | null;
  allowRemoteImages: boolean;
  onBlockedImages?: (count: number) => void;
  onQuoteToggle?: (expanded: boolean) => void;
};

const QUOTE_SELECTORS = [
  'div.gmail_quote',
  'blockquote[type="cite"]',
  'div.yahoo_quoted',
  '#divRplyFwdMsg',
  'div.moz-cite-prefix + blockquote',
  'blockquote.gmail_quote',
  'div[id^="appendonsend"]',
  'div.OutlookMessageHeader',
  'hr#stopSpelling',
  'blockquote',
];

function linkify(text: string): string {
  return escapeHtml(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]"'])/g, (url) => `<a href="${url}">${url}</a>`);
}

/** Folds quoted history in plain text by finding the first "On … wrote:" or "> " block. */
function foldPlainText(text: string): { main: string; quoted: string | null } {
  const lines = text.split('\n');
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*>/.test(line) || /^-----\s*Original Message\s*-----/i.test(line) || /^On .{4,120} wrote:\s*$/.test(line) || /^_{10,}\s*$/.test(line) || /^From:\s.+/.test(line) && lines[i + 1]?.startsWith('Sent:')) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) return { main: text, quoted: null };
  return { main: lines.slice(0, idx).join('\n'), quoted: lines.slice(idx).join('\n') };
}

function looksDesigned(html: string): boolean {
  return /<table|bgcolor=|background(-color)?\s*:|<center|width="6\d\d"|max-width:\s*6\d\d/i.test(html);
}

export function EmailBody({ messageId, html, text, allowRemoteImages, onBlockedImages, onQuoteToggle }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const doc = useMemo(() => {
    let body: string;
    let blocked = 0;
    let designed = false;
    if (html) {
      designed = looksDesigned(html);
      const clean = DOMPurify.sanitize(html, {
        WHOLE_DOCUMENT: false,
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio', 'source', 'track'],
        FORBID_ATTR: ['onerror', 'onload', 'srcset', 'ping', 'formaction'],
        ALLOW_UNKNOWN_PROTOCOLS: true,
        ADD_ATTR: ['target'],
      });
      const container = document.createElement('div');
      container.innerHTML = clean;

      for (const img of Array.from(container.querySelectorAll('img'))) {
        const src = img.getAttribute('src') ?? '';
        if (src.startsWith('cid:')) {
          img.setAttribute('src', `/api/messages/${messageId}/cid/${encodeURIComponent(src.slice(4).replace(/^<|>$/g, ''))}`);
        } else if (/^https?:/i.test(src) || src.startsWith('//')) {
          if (!allowRemoteImages) {
            blocked++;
            img.setAttribute('data-blocked-src', src);
            img.removeAttribute('src');
            img.setAttribute('alt', img.getAttribute('alt') || '');
            img.style.setProperty('background', 'repeating-linear-gradient(45deg, #e5e7eb 0 6px, #f3f4f6 6px 12px)');
            img.style.setProperty('min-width', '16px');
            img.style.setProperty('min-height', '16px');
          }
        } else if (!src.startsWith('data:')) {
          img.removeAttribute('src');
        }
        img.setAttribute('loading', 'lazy');
        img.setAttribute('referrerpolicy', 'no-referrer');
      }
      if (!allowRemoteImages) {
        for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
          const style = el.getAttribute('style') ?? '';
          if (/url\(\s*['"]?\s*https?:/i.test(style)) {
            blocked++;
            el.setAttribute('style', style.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none'));
          }
        }
        for (const el of Array.from(container.querySelectorAll('[background]'))) {
          el.removeAttribute('background');
          blocked++;
        }
      }
      for (const a of Array.from(container.querySelectorAll('a'))) {
        const href = a.getAttribute('href') ?? '';
        if (/^\s*javascript:/i.test(href) || /^\s*data:/i.test(href)) a.removeAttribute('href');
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        if (href && !a.getAttribute('title')) a.setAttribute('title', href);
      }
      // Fold the first quoted block.
      let quote: Element | null = null;
      for (const selector of QUOTE_SELECTORS) {
        quote = container.querySelector(selector);
        if (quote) break;
      }
      if (quote && quote.textContent && quote.textContent.trim().length > 0 && container.textContent && quote.textContent.trim().length < container.textContent.trim().length) {
        const toggle = document.createElement('button');
        toggle.setAttribute('data-mc-toggle', '1');
        toggle.setAttribute('type', 'button');
        toggle.setAttribute('aria-label', 'Show trimmed content');
        toggle.textContent = '···';
        quote.setAttribute('data-mc-quote', '1');
        quote.parentNode?.insertBefore(toggle, quote);
      }
      body = container.innerHTML;
    } else {
      const { main, quoted } = foldPlainText(text ?? '');
      body = `<pre class="mc-text">${linkify(main)}</pre>`;
      if (quoted) body += `<button data-mc-toggle="1" type="button" aria-label="Show trimmed content">···</button><pre class="mc-text" data-mc-quote="1">${linkify(quoted)}</pre>`;
    }

    const imgSrc = allowRemoteImages ? "img-src * data: blob: 'self'" : "img-src data: blob: 'self'";
    const csp = `default-src 'none'; ${imgSrc}; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; form-action 'none'; base-uri 'none'`;
    const textColor = dark && !designed ? '#e8eaf0' : '#1f2328';
    const linkColor = dark && !designed ? '#93c5fd' : '#1d4ed8';
    const background = dark && !designed ? 'transparent' : designed && dark ? '#ffffff' : 'transparent';
    const css = `
      :root { color-scheme: ${dark && !designed ? 'dark' : 'light'}; }
      html, body { margin: 0; padding: 0; }
      body { font-family: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.55; color: ${textColor}; background: ${background}; word-break: break-word; overflow-wrap: anywhere; padding: ${designed ? '8px' : '2px 0'}; ${designed && dark ? 'border-radius: 8px;' : ''} }
      a { color: ${linkColor}; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      pre.mc-text { white-space: pre-wrap; font-family: inherit; margin: 0; }
      blockquote { margin: 0.4em 0; padding-left: 0.9em; border-left: 3px solid #c7cbd6; color: ${dark && !designed ? '#a2a8b8' : '#57606a'}; }
      [data-mc-quote] { display: none; }
      [data-mc-quote].mc-open { display: block; }
      button[data-mc-toggle] { display: inline-flex; align-items: center; justify-content: center; margin: 10px 0 4px; height: 18px; min-width: 32px; padding: 0 8px; border-radius: 9px; border: 1px solid #c7cbd6; background: ${dark && !designed ? '#232833' : '#eef0f5'}; color: ${dark && !designed ? '#e8eaf0' : '#57606a'}; font: 700 12px/1 monospace; letter-spacing: 1px; cursor: pointer; }
      button[data-mc-toggle]:hover { background: ${dark && !designed ? '#343a48' : '#e3e6ee'}; }
    `;
    const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width"><base target="_blank"><style>${css}</style></head><body>${body}</body></html>`;
    return { htmlDoc, blocked };
  }, [html, text, allowRemoteImages, messageId, dark]);

  useEffect(() => {
    onBlockedImages?.(doc.blocked);
  }, [doc.blocked, onBlockedImages]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const d = iframe.contentDocument;
      if (!d?.documentElement) return;
      const h = Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight ?? 0);
      setHeight(Math.min(Math.max(h + 8, 40), 20000));
    };
    const onLoad = () => {
      const d = iframe.contentDocument;
      if (!d) return;
      measure();
      observer = new ResizeObserver(measure);
      if (d.body) observer.observe(d.body);
      for (const img of Array.from(d.images)) img.addEventListener('load', measure);
      d.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest('button[data-mc-toggle]');
        if (!target) return;
        e.preventDefault();
        const quote = target.nextElementSibling as HTMLElement | null;
        if (quote?.hasAttribute('data-mc-quote')) {
          const open = quote.classList.toggle('mc-open');
          target.setAttribute('aria-label', open ? 'Hide trimmed content' : 'Show trimmed content');
          onQuoteToggle?.(open);
          setTimeout(measure, 0);
        }
      });
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [doc.htmlDoc, onQuoteToggle]);

  return (
    <iframe
      ref={iframeRef}
      title="Message body"
      srcDoc={doc.htmlDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
