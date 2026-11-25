import { PLATFORMS } from '../src/shared/platforms';
import { isSearchable, normalizeName, validateFor } from '../src/shared/rules';
import type { CheckResult, PlatformId } from '../src/shared/types';
import { localGet, localPut } from './local-cache';
import { add, renderRow, renderSuggestion, renderXResult } from './render';
import { getToken, turnstileEnabled } from './turnstile';
import { parseNdjsonStream } from './stream';
import { generateSuggestions } from '../src/shared/suggest';
import { checkablePlatforms, checkOnX, findSuggestions, PAUSED_MSG, RATE_LIMIT_MSG } from './suggestions';

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
const suggestionsEl = $('suggestions');
const suggestionList = $('suggestion-list');
const suggestionMsg = $('suggestions-msg');
const suggestionTitle = $('suggestions-title');
const suggestionNote = $('suggestions-note');
const NO_VARIATION_MSG = 'No variation is free on every checked platform. Try a different name.';
const NO_FIT_MSG = "No variation fits every selected platform's rules.";
const FAILED_MSG = "Couldn't check suggestions. Try again.";

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
let controller: AbortController | null = null;

function resetSuggestions(): void {
  suggestionList.replaceChildren();
  suggestionMsg.hidden = true;
  suggestionTitle.hidden = true;
  suggestionNote.hidden = true;
  suggestionsEl.hidden = true;
}

async function runSuggestions(name: string, results: CheckResult[], my: number, signal: AbortSignal): Promise<void> {
  const ids = [...selected];
  if (!results.some((r) => r.status === 'taken' && selected.has(r.platform))) return;
  const notChecked = ids.filter((id) => !checkablePlatforms([id]).length).map((id) => PLATFORMS[id].label);
  let count = 0;
  const showSection = () => {
    suggestionsEl.hidden = false;
    if (notChecked.length) {
      suggestionNote.textContent = `Not checked automatically: ${notChecked.join(', ')}`;
      suggestionNote.hidden = false;
    }
  };
  const showMessage = (msg: string) => {
    showSection();
    suggestionTitle.hidden = true;
    suggestionList.replaceChildren();
    suggestionMsg.textContent = msg;
    suggestionMsg.hidden = false;
  };
  if (generateSuggestions(name, ids).length === 0) { showMessage(NO_FIT_MSG); return; }
  const outcome = await findSuggestions({
    name, platforms: ids, signal,
    fetch: (u, init) => fetch(u, init),
    getToken,
    requireToken: turnstileEnabled,
    takenOn: results.filter((r) => r.status === 'taken' && selected.has(r.platform)).map((r) => r.platform),
    onSuggestion: (s) => {
      if (my !== runId || signal.aborted) return;
      count++;
      showSection();
      suggestionTitle.hidden = false;
      add(suggestionList, renderSuggestion(s.name, s.unknown, selected.has('x') ? (slot) => {
        void checkOnX(s.name, (u, init) => fetch(u, init), signal).then((r) => {
          if (signal.aborted) return;
          const btn = slot.querySelector('button');
          if (!r && btn) {
            // Couldn't reach the checker: let the user retry.
            btn.disabled = false;
            slot.replaceChildren(btn, renderXResult(s.name, null));
            return;
          }
          slot.replaceChildren(renderXResult(s.name, r));
        });
      } : null));
    },
  });
  if (my !== runId || signal.aborted) return;
  if (outcome !== 'done' || count === 0) {
    showMessage(
      outcome === 'paused' ? PAUSED_MSG
        : outcome === 'rate-limited' ? RATE_LIMIT_MSG
        : outcome === 'failed' ? FAILED_MSG
        : NO_VARIATION_MSG,
    );
  }
}

async function run(raw: string): Promise<void> {
  const name = normalizeName(raw);
  const check = isSearchable(name);
  if (!check.ok) { showError(check.error); return; }
  if (selected.size === 0) { showError('Select at least one platform.'); return; }
  errorEl.hidden = true;
  const my = ++runId;
  goBtn.disabled = false; // a superseded run no longer owns the button
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  resetSuggestions();

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
  if (toRequest.length === 0) {
    await runSuggestions(name, have, my, signal);
    return;
  }

  goBtn.disabled = true;
  const fresh: CheckResult[] = [];
  let finished = false;
  try {
    const url = `/api/check?name=${encodeURIComponent(name)}&platforms=${toRequest.join(',')}`;
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      let msg = "Couldn't reach the checker. Try again.";
      try { const j = (await res.json()) as { error?: unknown }; if (j && typeof j.error === 'string') msg = j.error; } catch { /* keep default */ }
      if (my === runId && !signal.aborted) showError(msg);
      return;
    }
    await parseNdjsonStream(res.body, (r) => {
      fresh.push(r);
      if (my === runId) setRow(r);
    });
    localPut(name, [...have, ...fresh]);
    finished = true;
  } catch {
    if (my === runId && !signal.aborted) showError("Couldn't reach the checker. Try again.");
  } finally {
    if (my === runId) goBtn.disabled = false;
  }
  if (finished && my === runId) await runSuggestions(name, [...have, ...fresh], my, signal);
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
