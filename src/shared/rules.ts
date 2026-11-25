import type { PlatformId } from './types';

export function normalizeName(raw: string): string {
  const t = raw.trim();
  return (t.startsWith('@') ? t.slice(1) : t).toLowerCase();
}

export interface Rule {
  min: number;
  max: number;
  pattern: RegExp;
  describe: string;
}

// `pattern` checks the character set and shape only; length is checked via min/max.
// Rules marked TODO(verify) are conservative guesses to confirm against the source.
export const RULES: Record<PlatformId, Rule> = {
  // https://help.x.com/en/managing-your-account/x-username-rules
  x: { min: 4, max: 15, pattern: /^[a-z0-9_]+$/, describe: '4 to 15 characters: letters, digits, underscore' },
  // https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication
  github: {
    min: 1,
    max: 39,
    pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    describe: '1 to 39 characters: letters, digits, single inner hyphens',
  },
  // https://atproto.com/specs/handle (label before .bsky.social)
  bluesky: {
    min: 3,
    max: 18,
    pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    describe: '3 to 18 characters: letters, digits, hyphens (not at the ends)',
  },
  // https://docs.npmjs.com/cli/configuring-npm/package-json#name
  npm: { min: 1, max: 214, pattern: /^[a-z0-9._-]+$/, describe: '1 to 214 characters: letters, digits, . _ -' },
  // TODO(verify): https://www.youtube.com/account (handle rules: 3 to 30, letters, digits, _ - .)
  youtube: { min: 3, max: 30, pattern: /^[a-z0-9._-]+$/, describe: '3 to 30 characters: letters, digits, . _ -' },
  // TODO(verify): https://dev.to/enter?state=new-user
  devto: { min: 2, max: 30, pattern: /^[a-z0-9_]+$/, describe: '2 to 30 characters: letters, digits, underscore' },
  // TODO(verify): https://hashnode.com/onboard
  hashnode: { min: 2, max: 30, pattern: /^[a-z0-9_-]+$/, describe: '2 to 30 characters: letters, digits, _ -' },
  // TODO(verify): https://docs.gitlab.com/ee/user/reserved_names.html
  gitlab: {
    min: 2,
    max: 255,
    pattern: /^[a-z0-9_][a-z0-9_.-]*$/,
    describe: '2 to 255 characters: letters, digits, . _ - (must not start with . or -)',
  },
  // TODO(verify): https://huggingface.co/join
  huggingface: {
    min: 2,
    max: 42,
    pattern: /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/,
    describe: '2 to 42 characters: letters, digits, _ - (not at the ends)',
  },
  // TODO(verify): https://www.reddit.com/register
  reddit: { min: 3, max: 20, pattern: /^[a-z0-9_-]+$/, describe: '3 to 20 characters: letters, digits, _ -' },
  // TODO(verify): https://www.producthunt.com
  producthunt: { min: 2, max: 30, pattern: /^[a-z0-9_]+$/, describe: '2 to 30 characters: letters, digits, underscore' },
  // TODO(verify): https://news.ycombinator.com/newsguidelines.html
  hackernews: { min: 2, max: 15, pattern: /^[a-z0-9_-]+$/, describe: '2 to 15 characters: letters, digits, _ -' },
  // TODO(verify): https://peerlist.io/signup
  peerlist: { min: 3, max: 30, pattern: /^[a-z0-9_-]+$/, describe: '3 to 30 characters: letters, digits, _ -' },
  // TODO(verify): https://www.linkedin.com/help/linkedin/answer/a542685 (custom URL: 3 to 100, letters and digits)
  linkedin: { min: 3, max: 100, pattern: /^[a-z0-9-]+$/, describe: '3 to 100 characters: letters, digits, hyphen' },
};

export function validateFor(platform: PlatformId, name: string): { ok: true } | { ok: false; rule: string } {
  const r = RULES[platform];
  if (name.length < r.min || name.length > r.max || !r.pattern.test(name)) {
    return { ok: false, rule: r.describe };
  }
  return { ok: true };
}

export function isSearchable(name: string): { ok: true } | { ok: false; error: string } {
  if (name.length < 1 || name.length > 39) return { ok: false, error: 'Use 1 to 39 characters.' };
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    return { ok: false, error: 'Use only ASCII letters, digits, underscore, hyphen and dot.' };
  }
  return { ok: true };
}
