import { describe, expect, it } from 'vitest';
import { isSearchable, normalizeName, validateFor } from '../../src/shared/rules';
import { PLATFORMS } from '../../src/shared/platforms';

describe('normalizeName', () => {
  it('trims, strips one leading @ and lowercases', () => {
    expect(normalizeName('  @ShubhamV ')).toBe('shubhamv');
    expect(normalizeName('@@a')).toBe('@a');
  });
});

describe('validateFor', () => {
  it('enforces X length and charset', () => {
    expect(validateFor('x', 'shubhamvbuilds12')).toEqual({ ok: false, rule: expect.stringContaining('15') });
    expect(validateFor('x', 'shubhamvbuilds')).toEqual({ ok: true });
  });
  it('enforces GitHub charset and hyphen placement', () => {
    expect(validateFor('github', 'a_b').ok).toBe(false);
    expect(validateFor('github', '-abc').ok).toBe(false);
    expect(validateFor('github', 'abc-').ok).toBe(false);
    expect(validateFor('github', 'a--b').ok).toBe(false);
    expect(validateFor('github', 'shubham-v').ok).toBe(true);
  });
  it('enforces Bluesky and npm rules', () => {
    expect(validateFor('bluesky', 'ab').ok).toBe(false);
    expect(validateFor('bluesky', 'abc').ok).toBe(true);
    expect(validateFor('npm', 'a'.repeat(215)).ok).toBe(false);
    expect(validateFor('npm', 'my.pkg_name-1').ok).toBe(true);
  });
  it('has a rule for every platform', () => {
    for (const id of Object.keys(PLATFORMS) as (keyof typeof PLATFORMS)[]) {
      expect(validateFor(id, 'abcdef')).toEqual({ ok: true });
    }
  });
});

describe('isSearchable', () => {
  it('accepts 1 to 39 safe ASCII characters only', () => {
    expect(isSearchable('').ok).toBe(false);
    expect(isSearchable('a'.repeat(300)).ok).toBe(false);
    expect(isSearchable('шубхам').ok).toBe(false);
    expect(isSearchable('a b').ok).toBe(false);
    expect(isSearchable('a'.repeat(39))).toEqual({ ok: true });
    expect(isSearchable('a_b-c.d')).toEqual({ ok: true });
  });
});

describe('PLATFORMS', () => {
  it('has 14 platforms with urls', () => {
    const all = Object.values(PLATFORMS);
    expect(all).toHaveLength(14);
    for (const p of all) {
      expect(p.profileUrl('abc')).toContain('abc');
      expect(p.signupUrl).toMatch(/^https:\/\//);
      expect(p.enabled).toBe(true);
    }
    expect(PLATFORMS.linkedin.method).toBe('link-only');
    expect(PLATFORMS.x.method).toBe('page');
  });
});
