import { describe, it, expect } from 'vitest';
import { renderRow } from '../../web/render';
import { PLATFORMS } from '../../src/shared/platforms';
import type { CheckResult } from '../../src/shared/types';

const base: CheckResult = {
  platform: 'github',
  name: 'abc',
  status: 'free',
  url: 'https://github.com/abc',
  method: 'api',
  checkedAt: 1,
};

describe('renderRow', () => {
  it('free: shows note and links to signupUrl', () => {
    const row = renderRow(base);
    expect(row.textContent).toContain('No account found');
    expect(row.textContent).toContain('The platform may still reserve this name. Signup confirms it.');
    const a = row.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(PLATFORMS.github.signupUrl);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('taken: shows Taken and links to url', () => {
    const row = renderRow({ ...base, status: 'taken' });
    expect(row.textContent).toContain('Taken');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('https://github.com/abc');
  });

  it('unknown: shows reason and links to url', () => {
    const row = renderRow({ ...base, status: 'unknown', reason: 'timed out' });
    expect(row.textContent).toContain("Couldn't confirm");
    expect(row.textContent).toContain('timed out');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('https://github.com/abc');
  });

  it('invalid: shows rule text and no link', () => {
    const row = renderRow({ ...base, status: 'invalid', reason: '4 to 15 characters' });
    expect(row.textContent).toContain('4 to 15 characters');
    expect(row.querySelector('a')).toBeNull();
  });

  it('linkedin row says Check it yourself', () => {
    const row = renderRow({
      ...base,
      platform: 'linkedin',
      status: 'unknown',
      reason: "LinkedIn can't be checked publicly",
      url: 'https://www.linkedin.com/in/abc',
      method: 'link-only',
    });
    expect(row.textContent).toContain('Check it yourself');
    expect(row.querySelector('a')!.textContent).toBe('Check it yourself');
  });

  it('renders hostile reason as text, no elements', () => {
    const row = renderRow({ ...base, status: 'unknown', reason: '<img src=x onerror=alert(1)>' });
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('does not set href for non-http(s) urls', () => {
    const row = renderRow({ ...base, status: 'taken', url: 'javascript:alert(1)' });
    expect(row.querySelector('a')).toBeNull();
    expect(row.textContent).toContain('javascript:alert(1)');
  });
});
