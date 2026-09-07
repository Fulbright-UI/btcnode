import { z } from 'zod';

/** The complete list of things the control panel may do. Nothing else exists. */
export const CONTROL_ACTIONS = [
  'restart-bitcoind',
  'restart-electrs',
  'reboot',
  'poweroff',
] as const;

export const controlActionSchema = z.enum(CONTROL_ACTIONS);
export type ControlAction = z.infer<typeof controlActionSchema>;

export const controlRequestSchema = z.object({
  action: controlActionSchema,
});

export const controlResultSchema = z.object({
  ok: z.boolean(),
  action: controlActionSchema,
  message: z.string().optional(),
});
export type ControlResult = z.infer<typeof controlResultSchema>;

export const loginRequestSchema = z.object({
  password: z.string().min(1).max(1024),
});

export const sessionInfoSchema = z.object({
  authenticated: z.boolean(),
  /** Whether a control agent is reachable at all — without one the panel stays hidden */
  controlAvailable: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
