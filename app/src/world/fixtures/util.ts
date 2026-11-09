import type { NpcActionId, ScheduleEntry } from '../spec';
import { NPC_ACTION_IDS } from '../schema';

export const at = (hour: number, place: string, activity: ScheduleEntry['activity']): ScheduleEntry => ({ hour, place, activity });

/** Full action-id bias table with zero defaults, so fixtures are already normalised. */
export function bias(p: Partial<Record<NpcActionId, number>> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of NPC_ACTION_IDS) out[id] = p[id] ?? 0;
  return out;
}
