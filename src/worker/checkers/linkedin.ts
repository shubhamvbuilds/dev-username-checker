import type { Checker } from './types';
import { makeResult } from '../http';

// LinkedIn blocks anonymous checks, so we never make a request.
export const linkedin: Checker = {
  id: 'linkedin',
  check: async (name) =>
    makeResult('linkedin', name, { status: 'unknown', reason: "LinkedIn can't be checked publicly" }, 'link-only'),
};
