import type { PlatformId } from '../../shared/types';
import type { Checker } from './types';
import { bluesky } from './bluesky';
import { devto } from './devto';
import { github } from './github';
import { gitlab } from './gitlab';
import { hackernews } from './hackernews';
import { hashnode } from './hashnode';
import { huggingface } from './huggingface';
import { linkedin } from './linkedin';
import { npm } from './npm';
import { peerlist } from './peerlist';
import { producthunt } from './producthunt';
import { reddit } from './reddit';
import { youtube } from './youtube';

// X is added in Task 8.
export const CHECKERS: Partial<Record<PlatformId, Checker>> = {
  github, gitlab, npm, devto, hashnode, bluesky, huggingface,
  youtube, reddit, hackernews, producthunt, peerlist, linkedin,
};
