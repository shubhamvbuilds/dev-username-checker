import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { PLATFORMS } from '../src/shared/platforms';
import { isSearchable, normalizeName, validateFor } from '../src/shared/rules';
import type { CheckResult, PlatformId } from '../src/shared/types';
import { localGet, localPut } from './local-cache';
import { add, renderPlaceholder, renderRow, renderSuggestion, renderXResult } from './render';
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

const meterEl = $('meter');
const summaryLine = $('summary');

const PLATFORM_KEY = 'uc:platforms';
// Checked platforms first, "check it yourself" platforms last (X has no checker yet, so it sits with them);
// rows keep this order while results stream in.
const manual = (id: PlatformId) => Number(id === 'x' || PLATFORMS[id].method === 'link-only');
const enabledIds = (Object.keys(PLATFORMS) as PlatformId[])
  .filter((id) => PLATFORMS[id].enabled)
  .sort((a, b) => manual(a) - manual(b));

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
      ? `Checking all ${enabledIds.length} platforms`
      : `Checking ${selected.size} of ${enabledIds.length} platforms`;
}

for (const id of enabledIds) {
  const label = document.createElement('label');
  label.className = 'chip';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = selected.has(id);
  cb.addEventListener('change', () => {
    if (cb.checked) selected.add(id); else selected.delete(id);
    saveSelected();
    updateSummary();
    if (mode === 'preview') showPreview(input.value);
  });
  const text = document.createElement('span');
  text.textContent = PLATFORMS[id].label;
  add(label, cb, text);
  add(listEl, label);
}
updateSummary();

function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

const orderedSelected = (): PlatformId[] => enabledIds.filter((id) => selected.has(id));

/** Status counts drawn as one segment per platform, plus a one-line summary. */
function updateMeter(): void {
  const rows = [...rowsEl.children] as HTMLElement[];
  const kinds = rows.map((r) => (['free', 'taken', 'unknown', 'invalid', 'pending'].find((k) => r.classList.contains(`row-${k}`)) ?? 'idle'));
  meterEl.replaceChildren(...kinds.map((k) => {
    const s = document.createElement('span');
    s.className = `seg seg-${k}`;
    return s;
  }));
  const n = (k: string) => kinds.filter((x) => x === k).length;
  if (kinds.every((k) => k === 'idle')) {
    summaryLine.textContent = input.value.trim()
      ? `${kinds.length} profile links · press Enter to check`
      : 'Type a name to see your profile links';
    return;
  }
  summaryLine.replaceChildren();
  const parts: [number, string, string][] = [
    [n('free'), 'free', 's-free'],
    [n('taken'), 'taken', 's-taken'],
    [n('unknown'), 'to check yourself', ''],
    [n('invalid'), 'not allowed', ''],
    [n('pending'), 'checking', ''],
  ];
  parts.filter(([c]) => c > 0).forEach(([c, label, cls], i) => {
    if (i > 0) add(summaryLine, ' · ');
    const b = document.createElement('b');
    if (cls) b.className = cls;
    b.textContent = String(c);
    add(summaryLine, b, ` ${label}`);
  });
}

function setRow(r: CheckResult): void {
  const next = renderRow(r);
  const old = rowsEl.querySelector(`[data-platform="${r.platform}"]`);
  if (old) old.replaceWith(next); else add(rowsEl, next);
  updateMeter();
}

let mode: 'preview' | 'results' = 'preview';

/** Before a search: show the profile URLs the typed name would have, with no status. */
function showPreview(raw: string): void {
  mode = 'preview';
  const name = normalizeName(raw) || 'yourname';
  resultName.textContent = name;
  rowsEl.replaceChildren(...orderedSelected().map((id) => renderPlaceholder(id, name, 'idle')));
  updateMeter();
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
    // Platforms that can never confirm free can't be required to be free for a suggestion.
    takenOn: results
      .filter((r) => r.status === 'taken' && selected.has(r.platform) && !PLATFORMS[r.platform].neverFree)
      .map((r) => r.platform),
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

  mode = 'results';
  resultName.textContent = name;
  resultsEl.hidden = false;
  // Every selected platform gets a fixed row now; results replace rows in place, so nothing jumps.
  rowsEl.replaceChildren(...orderedSelected().map((id) => renderPlaceholder(id, name, 'pending')));
  updateMeter();

  const toRequest: PlatformId[] = [];
  const have: CheckResult[] = [];
  const cached = localGet(name) ?? [];
  for (const id of orderedSelected()) {
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
    if (my === runId) {
      goBtn.disabled = false;
      // A platform that never answered (error or cut-off stream) stops spinning.
      for (const row of rowsEl.querySelectorAll<HTMLElement>('.row-pending')) {
        row.replaceWith(renderPlaceholder(row.dataset.platform as PlatformId, name, 'idle'));
      }
      updateMeter();
    }
  }
  if (finished && my === runId) await runSuggestions(name, [...have, ...fresh], my, signal);
}

form.addEventListener('submit', (e) => { e.preventDefault(); void run(input.value); });

input.addEventListener('input', () => {
  errorEl.hidden = true;
  // Editing the name after a search goes back to the live preview.
  if (mode === 'results' && normalizeName(input.value) === resultName.textContent) return;
  controller?.abort();
  runId++;
  goBtn.disabled = false;
  resetSuggestions();
  showPreview(input.value);
});

// Clicking a suggested name checks it.
function pickSuggestion(target: EventTarget | null): void {
  const nameEl = (target as HTMLElement | null)?.closest?.('.sugg-name');
  if (!nameEl?.textContent) return;
  input.value = nameEl.textContent;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void run(input.value);
}
suggestionList.addEventListener('click', (e) => pickSuggestion(e.target));
suggestionList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSuggestion(e.target); }
});

showPreview(input.value);

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
