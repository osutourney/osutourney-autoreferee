import type { DraftRuntime, MappoolSlot } from './types.js';

export type SlotContext = 'protect' | 'ban' | 'pick' | 'tb';

export function filterAvailableSlots(
  pool: MappoolSlot[],
  draft: DraftRuntime,
  context: SlotContext,
): MappoolSlot[] {
  const protectedSlots = new Set(draft.protects.map((row) => row.slot));
  const banned = new Set(draft.bans.map((row) => row.slot));
  const picked = new Set(draft.picks.map((row) => row.slot));

  return pool.filter((row) => {
    if (row.tiebreaker) return context === 'tb';
    if (context === 'tb') return false;
    if (picked.has(row.slot) || banned.has(row.slot)) return false;
    if (context === 'protect') {
      if (row.unprotectable || protectedSlots.has(row.slot)) return false;
      return true;
    }
    if (context === 'ban') {
      if (row.unbannable || protectedSlots.has(row.slot)) return false;
      return true;
    }
    // pick: protects still available
    return true;
  });
}

export function formatSlotList(slots: MappoolSlot[]): string {
  if (!slots.length) return '(none)';
  return slots.map((row) => row.slot).join(', ');
}
