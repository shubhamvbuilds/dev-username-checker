import { PLATFORMS } from '../src/shared/platforms';
import { isSearchable, normalizeName, validateFor } from '../src/shared/rules';
import type { CheckResult, PlatformId } from '../src/shared/types';
import { localGet, localPut } from './local-cache';
import { add, renderRow } from './render';
import { parseNdjsonStream } from './stream';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const input = $<HTMLInputElement>('name');
const goBtn = $<HTMLButtonElement>('go');
const errorEl = $('error');
const resultsEl = $('results');
const rowsEl = $('rows');
const resultName = $('result-name');
const copyBtn = $<HTMLButtonElement>('copy');
const listEl = $('platform-list');
const summaryEl = $('platforms-summary');

const PLATFORM_KEY = 'uc:platforms';
const enabledIds = (Object.keys(PLATFORMS) as PlatformId[]).filter((id) => PLATFORMS[id].enabled);

function loadSelected(): Set<PlatformId> {
  try {
    const raw = localStorage.getItem(PLATFORM_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const s = new Set(enabledIds.filter((id) => arr.includes(id)));
        if (s.size) return s;
      }
    }
  } catch { /* ignore */ }
  return new Set(enabledIds);
}

const selected = loadSelected();

function saveSelected(): void {
  try { localStorage.setItem(PLATFORM_KEY, JSON.stringify([...selected])); } catch { /* ignore */ }
}

function updateSummary(): void {
  summaryEl.textContent =
    selected.size === enabledIds.length
      ? `Platforms: all ${enabledIds.length} (edit)`
      : `Platforms: ${selected.size} of ${enabledIds.length} (edit)`;
}

for (const id of enabledIds) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = selected.has(id);
  cb.addEventListener('change', () => {
    if (cb.checked) selected.add(id); else selected.delete(id);
    saveSelected();
    updateSummary();
  });
  add(label, cb, ` ${PLATFORMS[id].label}`);
  add(listEl, label);
}
updateSummary();

function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function setRow(r: CheckResult): void {
  const next = renderRow(r);
  const old = rowsEl.querySelector(`[data-platform="${r.platform}"]`);
  if (old) old.replaceWith(next); else add(rowsEl, next);
}

let runId = 0;

async function run(raw: string): Promise<void> {
  const name = normalizeName(raw);
  const check = isSearchable(name);
  if (!check.ok) { showError(check.error); return; }
  if (selected.size === 0) { showError('Select at least one platform.'); return; }
  errorEl.hidden = true;
  const my = ++runId;

  rowsEl.replaceChildren();
  resultName.textContent = name;
  resultsEl.hidden = false;

  const toRequest: PlatformId[] = [];
  const have: CheckResult[] = [];
  const cached = localGet(name) ?? [];
  for (const id of enabledIds) {
    if (!selected.has(id)) continue;
    const v = validateFor(id, name);
    if (!v.ok) {
      setRow({ platform: id, name, status: 'invalid', reason: v.rule, url: PLATFORMS[id].profileUrl(name), method: 'rules', checkedAt: Date.now() });
      continue;
    }
    const hit = cached.find((c) => c.platform === id);
    if (hit) { setRow(hit); have.push(hit); } else toRequest.push(id);
  }
  if (toRequest.length === 0) return;

  goBtn.disabled = true;
  const fresh: CheckResult[] = [];
  try {
    const url = `/api/check?name=${encodeURIComponent(name)}&platforms=${toRequest.join(',')}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      let msg = "Couldn't reach the checker. Try again.";
      try { const j = (await res.json()) as { error?: unknown }; if (j && typeof j.error === 'string') msg = j.error; } catch { /* keep default */ }
      if (my === runId) showError(msg);
      return;
    }
    await parseNdjsonStream(res.body, (r) => {
      fresh.push(r);
      if (my === runId) setRow(r);
    });
    localPut(name, [...have, ...fresh]);
  } catch {
    if (my === runId) showError("Couldn't reach the checker. Try again.");
  } finally {
    if (my === runId) goBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); void run(input.value); });

copyBtn.addEventListener('click', async () => {
  const text = resultName.textContent ?? '';
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else { input.value = text; input.select(); document.execCommand('copy'); }
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => { copyBtn.textContent = 'Copy name'; }, 1500);
});
