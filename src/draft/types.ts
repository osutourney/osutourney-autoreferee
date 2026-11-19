import { z } from 'zod';

export const draftSideSchema = z.enum(['red', 'blue']);
export type DraftSide = z.infer<typeof draftSideSchema>;

export const draftPhaseOrderSchema = z.enum(['abba', 'abab', 'winner_first', 'loser_first', 'fixed']);
export type DraftPhaseOrder = z.infer<typeof draftPhaseOrderSchema>;

export const draftScriptPhaseSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('protect'),
    countPerSide: z.number().int().min(0).max(8).default(1),
    order: draftPhaseOrderSchema.default('abba'),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('ban'),
    countPerSide: z.number().int().min(0).max(8).default(1),
    order: draftPhaseOrderSchema.default('abba'),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('pick_play'),
    until: z.union([
      z.object({ kind: z.literal('maps_played'), count: z.number().int().min(1) }),
      z.object({ kind: z.literal('first_to'), n: z.number().int().min(1) }),
    ]),
  }),
]);

export type DraftScriptPhase = z.infer<typeof draftScriptPhaseSchema>;

export const fmRuleGroupSchema = z.object({
  anyOf: z.array(z.array(z.string())).min(1),
  count: z.number().int().min(0).default(1),
  max: z.number().int().min(0).optional(),
});

export const fmRulesSchema = z.object({
  requiredGroups: z.array(fmRuleGroupSchema).default([]),
  scope: z.enum(['lobby', 'per_team']).default('lobby'),
});
export type FmRules = z.infer<typeof fmRulesSchema>;

export const mappoolSlotSchema = z.object({
  slot: z.string().min(1),
  beatmapId: z.string().min(1),
  mods: z.array(z.string()).default([]),
  /** When true (or mods includes FM), lobby uses `!mp mods Freemod`. */
  freemod: z.boolean().default(false),
  fmRules: fmRulesSchema.optional(),
  unbannable: z.boolean().default(false),
  unprotectable: z.boolean().default(false),
  tiebreaker: z.boolean().default(false),
}).transform((slot) => {
  const hasFmToken = slot.mods.some((mod) => {
    const key = mod.replace(/^\+/, '').trim().toUpperCase();
    return key === 'FM' || key === 'FREEMOD';
  });
  return {
    ...slot,
    freemod: slot.freemod || hasFmToken || slot.slot.toUpperCase().startsWith('FM'),
  };
});

export type MappoolSlot = z.infer<typeof mappoolSlotSchema>;

export type DraftEntry = {
  side: DraftSide;
  slot: string;
  beatmapId: string;
  kind: 'protect' | 'ban' | 'pick';
};

export type DraftRuntime = {
  script: DraftScriptPhase[];
  scriptIndex: number;
  actionsDoneInPhase: number;
  protects: DraftEntry[];
  bans: DraftEntry[];
  picks: DraftEntry[];
  score: { red: number; blue: number };
  firstPickSide?: DraftSide;
  rollWinner?: DraftSide;
  choice?: 'first_protect_ban' | 'first_ban' | 'first_pick';
  mapsPlayed: number;
};
