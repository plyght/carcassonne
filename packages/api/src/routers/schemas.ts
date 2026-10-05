import { z } from "zod";

export const rulesetSchema = z.object({
  fieldEdition: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  river: z.boolean(),
  abbot: z.boolean(),
  handSize: z.number().int().min(1).max(3),
});

export const clockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("turn"), turnSeconds: z.number().int().min(10).max(600) }),
  z.object({
    type: z.literal("bank"),
    bankSeconds: z.number().int().min(60).max(3600),
    incrementSeconds: z.number().int().min(0).max(60),
  }),
]);

export const botTierSchema = z.enum(["easy", "medium", "hard", "expert"]);
export const queueSchema = z.enum(["ffa3", "ffa4"]);

export const moveSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  figure: z
    .union([
      z.object({ type: z.enum(["meeple", "abbot"]), feature: z.number().int().min(0) }),
      z.object({ type: z.literal("recallAbbot"), x: z.number().int(), y: z.number().int() }),
    ])
    .nullable(),
});
