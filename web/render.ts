import { PLATFORMS } from '../src/shared/platforms';
import type { CheckResult, PlatformId } from '../src/shared/types';

const RESERVE_NOTE = 'The platform may still reserve this name. Signup confirms it.';
const SVG = 'http://www.w3.org/2000/svg';

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

// Lucide icon geometry (ISC), 24px grid, 1.5 stroke.
const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
  ban: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'm4.9 4.9 14.2 14.2'],
  dot: ['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  pending: ['M21 12a9 9 0 1 1-6.22-8.56'],
  out: ['M7 7h10v10', 'M7 17 17 7'],
} as const;
type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = 'ico'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** Link for http(s) URLs; plain text otherwise. */
function linkOrText(url: string, text: string, cls: string | null = null, withIcon = false): HTMLElement {
  if (!isHttp(url)) return el('span', 'link-text', `${text} (${url})`);
  const a = document.createElement('a');
  if (cls) a.className = cls;
  a.textContent = text;
  if (withIcon) a.appendChild(icon('out', ''));
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** The profile URL with the handle highlighted, e.g. github.com/<mark>name</mark>. */
function urlLine(platform: PlatformId, name: string): HTMLElement {
  const meta = PLATFORMS[platform];
  const line = el('span', 'url');
  const full = (meta ? meta.profileUrl(name) : name).replace(/^https?:\/\//, '').replace(/^www\./, '');
  const at = name ? full.lastIndexOf(name) : -1;
  if (at < 0) {
    line.textContent = full;
  } else {
    add(line, full.slice(0, at), el('mark', null, name), full.slice(at + name.length));
  }
  if (meta) line.title = meta.label;
  return line;
}

function shell(platform: PlatformId, name: string, cls: string, ico: IconName): { row: HTMLElement; meta: HTMLElement; act: HTMLElement } {
  const row = el('li', `row ${cls}`);
  row.dataset.platform = platform;
  const who = el('span', 'who');
  const label = PLATFORMS[platform]?.label ?? platform;
  add(who, urlLine(platform, name));
  const meta = el('span', 'meta', label);
  add(who, meta);
  const act = el('span', 'act');
  add(row, icon(ico), who, act);
  return { row, meta, act };
}

/** A row before a result exists: idle (preview while typing) or pending (request in flight). */
export function renderPlaceholder(platform: PlatformId, name: string, state: 'idle' | 'pending'): HTMLElement {
  const { row, act } = shell(platform, name, `row-${state}`, state === 'pending' ? 'pending' : 'dot');
  add(act, el('span', 'status', state === 'pending' ? 'Checking' : '—'));
  return row;
}

export function renderRow(r: CheckResult): HTMLElement {
  const info = PLATFORMS[r.platform];
  const icoFor: Record<CheckResult['status'], IconName> = { free: 'check', taken: 'x', unknown: 'help', invalid: 'ban' };
  const { row, meta, act } = shell(r.platform, r.name, `row-${r.status}`, icoFor[r.status]);

  if (r.status === 'free') {
    add(row, el('span', 'sr', RESERVE_NOTE));
    if (info?.freeNote) meta.textContent = `${info.label} · ${info.freeNote}`;
    add(act, el('strong', 'status', 'No account found'));
    if (info) add(act, linkOrText(info.signupUrl, 'Sign up', 'go', true));
  } else if (r.status === 'taken') {
    add(act, el('strong', 'status', 'Taken'), linkOrText(r.url, 'View profile', 'go', true));
  } else if (r.status === 'unknown') {
    if (r.reason) meta.textContent = `${info?.label ?? r.platform} · ${r.reason}`;
    add(act, el('strong', 'status', "Couldn't confirm"));
    add(act, linkOrText(r.url, r.method === 'link-only' ? 'Check it yourself' : 'Check manually', 'go', true));
  } else {
    add(act, el('span', 'status', r.reason ?? 'Not a valid name here'));
  }
  return row;
}

/** A suggestion card: the name (click to search it), status, and an optional "X: check" control. */
export function renderSuggestion(name: string, unknown: PlatformId[], onCheckX: ((slot: HTMLElement) => void) | null): HTMLElement {
  const card = el('li', 'sugg');
  card.dataset.name = name;
  const nameEl = el('span', 'sugg-name', name);
  nameEl.setAttribute('role', 'button');
  nameEl.tabIndex = 0;
  nameEl.title = `Check ${name}`;
  add(card, nameEl);
  const status = el('span', 'sugg-status');
  add(status, icon('check', ''), unknown.length ? 'Free where checked' : 'Free on all checked');
  add(card, status);
  if (unknown.length) {
    const order = Object.keys(PLATFORMS);
    const labels = [...unknown].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => PLATFORMS[p]?.label ?? p);
    add(card, el('p', 'note', `Couldn't confirm: ${labels.join(', ')}`));
  }
  if (onCheckX) {
    const slot = el('span', 'x-slot');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'X: check →';
    btn.addEventListener('click', () => { btn.disabled = true; onCheckX(slot); });
    add(slot, btn);
    add(card, slot);
  }
  return card;
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
