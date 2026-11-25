import type { PlatformId, PlatformMeta } from './types';

// Profile and signup URLs. Methods are the planned check strategy; later tasks
// flip `enabled` per platform once a checker is verified.
// TODO(verify): confirm each profile URL pattern and signup URL against the live site.
export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  github: {
    id: 'github',
    label: 'GitHub',
    profileUrl: (n) => `https://github.com/${n}`,
    signupUrl: 'https://github.com/signup',
    enabled: true,
    method: 'api',
  },
  x: {
    id: 'x',
    label: 'X',
    profileUrl: (n) => `https://x.com/${n}`,
    signupUrl: 'https://x.com/i/flow/signup',
    enabled: true,
    method: 'page',
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    profileUrl: (n) => `https://www.youtube.com/@${n}`,
    signupUrl: 'https://www.youtube.com/account',
    enabled: true,
    method: 'page',
  },
  devto: {
    id: 'devto',
    label: 'DEV',
    profileUrl: (n) => `https://dev.to/${n}`,
    signupUrl: 'https://dev.to/enter?state=new-user',
    enabled: true,
    method: 'page', // profile page: org names (dev.to/github) are not in the users API
  },
  hashnode: {
    id: 'hashnode',
    label: 'Hashnode',
    profileUrl: (n) => `https://hashnode.com/@${n}`,
    signupUrl: 'https://hashnode.com/onboard',
    enabled: true,
    method: 'link-only', // GraphQL endpoint moved (gql.hashnode.com 301s to an announcement), 2026-11-25
  },
  bluesky: {
    id: 'bluesky',
    label: 'Bluesky',
    profileUrl: (n) => `https://bsky.app/profile/${n}.bsky.social`,
    signupUrl: 'https://bsky.app',
    enabled: true,
    method: 'api',
  },
  npm: {
    id: 'npm',
    label: 'npm',
    profileUrl: (n) => `https://www.npmjs.com/~${n}`,
    signupUrl: 'https://www.npmjs.com/signup',
    enabled: true,
    method: 'link-only', // registry user lookup needs auth; www.npmjs.com blocks bots (403), 2026-11-25
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    profileUrl: (n) => `https://gitlab.com/${n}`,
    signupUrl: 'https://gitlab.com/users/sign_up',
    enabled: true,
    method: 'api',
    freeNote: 'GitLab hides private groups, so this name may still be taken.',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    profileUrl: (n) => `https://huggingface.co/${n}`,
    signupUrl: 'https://huggingface.co/join',
    enabled: true,
    method: 'api',
  },
  reddit: {
    id: 'reddit',
    label: 'Reddit',
    profileUrl: (n) => `https://www.reddit.com/user/${n}`,
    signupUrl: 'https://www.reddit.com/register',
    enabled: true,
    method: 'api',
  },
  producthunt: {
    id: 'producthunt',
    label: 'Product Hunt',
    profileUrl: (n) => `https://www.producthunt.com/@${n}`,
    signupUrl: 'https://www.producthunt.com',
    enabled: true,
    method: 'page',
  },
  hackernews: {
    id: 'hackernews',
    label: 'Hacker News',
    profileUrl: (n) => `https://news.ycombinator.com/user?id=${n}`,
    signupUrl: 'https://news.ycombinator.com/login',
    enabled: true,
    method: 'api',
  },
  peerlist: {
    id: 'peerlist',
    label: 'Peerlist',
    profileUrl: (n) => `https://peerlist.io/${n}`,
    signupUrl: 'https://peerlist.io/signup',
    enabled: true,
    method: 'link-only', // Cloudflare challenge (403) on every profile URL, 2026-11-25
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    profileUrl: (n) => `https://www.linkedin.com/in/${n}`,
    signupUrl: 'https://www.linkedin.com/signup',
    enabled: true,
    method: 'link-only',
  },
};
