import type { CheckResult, PlatformId } from '../../shared/types';
import type { CheckDeps } from '../env';

export interface Checker {
  id: PlatformId;
  check(name: string, deps: CheckDeps): Promise<CheckResult>;
}
