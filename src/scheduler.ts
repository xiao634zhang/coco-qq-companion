import type { Config, State } from './store.ts';
import { shanghai } from './store.ts';

export function nextCheck(config: Config, now = Date.now(), random = Math.random) {
  const p = config.proactive;
  return now + (p.minMinutes + random() * (p.maxMinutes - p.minMinutes)) * 60000;
}
export function proactiveEligible(config: Config, state: State, online: boolean, busy: boolean, now = Date.now()) {
  const p = config.proactive, date = shanghai(now);
  if (!p.enabled || !config.ownerQQ || state.paused || state.blocked || !online || busy) return false;
  if (date.hour < p.startHour || date.hour >= p.endHour) return false;
  if (!state.lastUserAt || now - state.lastUserAt < p.idleMinutes * 60000) return false;
  if (state.lastProactiveAt && now - state.lastProactiveAt < p.gapMinutes * 60000) return false;
  return state.proactiveDay !== date.day || state.proactiveCount < p.dailyMax;
}
