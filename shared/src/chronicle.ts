import { z } from 'zod';

/** One line of the chronicle typed into the header. Dates may be a year, a
 * year-month or a full ISO date — no day is invented where none is known. */
export const chronicleEntrySchema = z.object({
  date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  who: z.string().min(1),
  text: z.string().min(1),
});

export const chronicleSchema = z.object({
  /** Unix seconds when the backend started; entry n = floor((now - start) / interval) */
  start: z.number().int(),
  /** Seconds per entry — the status interval */
  interval: z.number().int().positive(),
  entries: z.array(chronicleEntrySchema).min(1),
});

export type ChronicleEntry = z.infer<typeof chronicleEntrySchema>;
export type Chronicle = z.infer<typeof chronicleSchema>;
