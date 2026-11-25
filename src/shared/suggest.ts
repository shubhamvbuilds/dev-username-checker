import { validateFor } from './rules';
import type { PlatformId } from './types';

const SUFFIXES = ['builds', 'codes', 'dev', 'hq', 'labs', 'ships'];
const PREFIXES = ['hey', 'the', 'iam'];

/**
 * Candidate alternatives for `base`, in a fixed order: suffixes, prefixes, then
 * `{first part}{first letter of the second part}` when the input has a separator.
 * Only names valid on every selected platform are kept; deduplicated, never `base`.
 */
export function generateSuggestions(base: string, platforms: PlatformId[], count = 6): string[] {
  const candidates: string[] = [];
  for (const s of SUFFIXES) candidates.push(base + s);
  for (const p of PREFIXES) candidates.push(p + base);
  const parts = base.split(/[-_.]/).filter(Boolean);
  if (parts[0] && parts[1]) candidates.push(parts[0] + parts[1][0]);

  const out: string[] = [];
  for (const c of candidates) {
    if (c === base || out.includes(c)) continue;
    if (!platforms.every((p) => validateFor(p, c).ok)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}
