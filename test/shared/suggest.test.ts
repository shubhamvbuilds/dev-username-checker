import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../../src/shared/suggest';
import { validateFor } from '../../src/shared/rules';

describe('generateSuggestions', () => {
  it('returns 6 names valid on every selected platform, never the base', () => {
    const out = generateSuggestions('shubham', ['x', 'github']);
    expect(out).toHaveLength(6);
    expect(out).not.toContain('shubham');
    for (const n of out) {
      expect(validateFor('x', n).ok).toBe(true);
      expect(validateFor('github', n).ok).toBe(true);
    }
  });

  it('follows the stated pattern order', () => {
    expect(generateSuggestions('shubham', ['github'])).toEqual([
      'shubhambuilds', 'shubhamcodes', 'shubhamdev', 'shubhamhq', 'shubhamlabs', 'shubhamships',
    ]);
  });

  it('respects the x 15 character limit for a 13 character base', () => {
    const out = generateSuggestions('abcdefghijklm', ['x']);
    expect(out.length).toBeGreaterThan(0);
    for (const n of out) expect(n.length).toBeLessThanOrEqual(15);
  });

  it('adds base + first letter of second part for separated input, deduplicated', () => {
    const out = generateSuggestions('john-doe', ['github'], 20);
    expect(out).toContain('john-doed');
    expect(new Set(out).size).toBe(out.length);
  });

  it('is deterministic', () => {
    expect(generateSuggestions('shubham', ['x', 'github'])).toEqual(generateSuggestions('shubham', ['x', 'github']));
  });
});
