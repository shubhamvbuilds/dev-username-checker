import type { PlatformId } from '../../shared/types';
import type { Checker } from './types';
import { bluesky } from './bluesky';
import { devto } from './devto';
import { github } from './github';
import { gitlab } from './gitlab';
import { hackernews } from './hackernews';
import { huggingface } from './huggingface';
import { linkedin } from './linkedin';
import { producthunt } from './producthunt';
import { reddit } from './reddit';
import { youtube } from './youtube';

// X is added in Task 8. npm, hashnode and peerlist are link-only (no checker).
export const CHECKERS: Partial<Record<PlatformId, Checker>> = {
  github, gitlab, devto, bluesky, huggingface,
  youtube, reddit, hackernews, producthunt, linkedin,
};
