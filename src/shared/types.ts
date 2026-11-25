export type PlatformId =
  | 'github'
  | 'x'
  | 'youtube'
  | 'devto'
  | 'hashnode'
  | 'bluesky'
  | 'npm'
  | 'gitlab'
  | 'huggingface'
  | 'reddit'
  | 'producthunt'
  | 'hackernews'
  | 'peerlist'
  | 'linkedin';

export type Status = 'free' | 'taken' | 'unknown' | 'invalid';

export type Method = 'api' | 'page' | 'browser' | 'link-only' | 'rules';

export interface CheckResult {
  platform: PlatformId;
  name: string;
  status: Status;
  reason?: string;
  url: string;
  method: Method;
  checkedAt: number;
}

export interface PlatformMeta {
  id: PlatformId;
  label: string;
  profileUrl(name: string): string;
  signupUrl: string;
  enabled: boolean;
  method: Method;
}
