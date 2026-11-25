import { PLATFORMS } from '../src/shared/platforms';
import type { CheckResult } from '../src/shared/types';

const RESERVE_NOTE = 'The platform may still reserve this name. Signup confirms it.';

function isHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

function el(tag: string, cls: string | null, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Link for http(s) URLs; plain text otherwise. */
function linkOrText(url: string, text: string): HTMLElement {
  if (!isHttp(url)) return el('span', 'link-text', `${text} (${url})`);
  const a = document.createElement('a');
  a.textContent = text;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function renderRow(r: CheckResult): HTMLElement {
  const meta = PLATFORMS[r.platform];
  const row = el('li', `row row-${r.status}`);
  row.dataset.platform = r.platform;
  add(row, el('span', 'platform', meta ? meta.label : r.platform));
  const body = el('span', 'detail');

  if (r.status === 'free') {
    add(body, el('strong', 'status', 'No account found'), el('span', 'note', RESERVE_NOTE));
    if (meta) add(body, linkOrText(meta.signupUrl, 'Sign up'));
  } else if (r.status === 'taken') {
    add(body, el('strong', 'status', 'Taken'), linkOrText(r.url, 'View profile'));
  } else if (r.status === 'unknown') {
    add(body, el('strong', 'status', "Couldn't confirm"));
    if (r.reason) add(body, el('span', 'note', r.reason));
    add(body, linkOrText(r.url, r.method === 'link-only' ? 'Check it yourself' : 'Check manually'));
  } else {
    add(body, el('span', 'status', r.reason ?? 'Not a valid name here'));
  }
  add(row, body);
  return row;
}

/** A suggestion row: the name, plus an optional "X: check" control rendered in place by the caller. */
export function renderSuggestion(name: string, onCheckX: ((slot: HTMLElement) => void) | null): HTMLElement {
  const row = el('li', 'row row-free');
  row.dataset.name = name;
  add(row, el('span', 'platform', name));
  const body = el('span', 'detail');
  add(body, el('strong', 'status', 'Free on all selected'));
  if (onCheckX) {
    const slot = el('span', 'x-slot');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'X: check →';
    btn.addEventListener('click', () => { btn.disabled = true; onCheckX(slot); });
    add(slot, btn);
    add(body, slot);
  }
  add(row, body);
  return row;
}

/** Outcome of an on-demand X check, shown in place of the button. */
export function renderXResult(name: string, r: CheckResult | null): HTMLElement {
  if (!r) return el('span', 'note', "Couldn't reach the checker. Try again.");
  if (r.status === 'unknown' && r.method === 'link-only') return linkOrText(`https://x.com/${encodeURIComponent(name)}`, 'Check on X →');
  const label = r.status === 'free' ? 'X: free' : r.status === 'taken' ? 'X: taken' : r.status === 'invalid' ? `X: ${r.reason ?? 'invalid'}` : "X: couldn't confirm";
  const span = el('span', `status-${r.status}`, label);
  if (r.status === 'free' || r.status === 'taken') return span;
  const wrap = el('span', 'x-result');
  add(wrap, span);
  if (r.status === 'unknown') add(wrap, linkOrText(r.url, 'Check manually'));
  return wrap;
}

// workers-types shadows DOM's Element.append typing, so append via appendChild.
export function add(parent: Node, ...kids: (Node | string)[]): void {
  for (const k of kids) parent.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
}
