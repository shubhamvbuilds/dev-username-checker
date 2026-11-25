import type { Env } from './env';

export type TrafficLevel = 0 | 1 | 2 | 3;

// Anything other than "0".."3" means 0.
export function trafficLevel(env: Env): TrafficLevel {
  const n = Number(env.TRAFFIC_LEVEL);
  return n === 1 || n === 2 || n === 3 ? n : 0;
}
