import type { CheckResult } from '../src/shared/types';

const TTL_MS = 60 * 60 * 1000;
const key = (name: string) => `uc:v1:${name}`;

export function localGet(name: string, now: number = Date.now()): CheckResult[] | null {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; results: CheckResult[] };
    if (typeof v.at !== 'number' || !Array.isArray(v.results) || now - v.at > TTL_MS) return null;
    return v.results;
  } catch {
    return null;
  }
}

export function localPut(name: string, results: CheckResult[], now: number = Date.now()): void {
  try {
    const keep = results.filter((r) => r.status !== 'unknown');
    localStorage.setItem(key(name), JSON.stringify({ at: now, results: keep }));
  } catch {
    // storage unavailable or full: caching is best effort
  }
}
