import { z } from 'zod';

export const updatePreferenceSchema = z.object({
  channel: z.enum(['websocket', 'fcm', 'email']),
  eventType: z.string().default('*'),
  enabled: z.boolean(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)')
    .optional()
    .nullable(),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)')
    .optional()
    .nullable(),
});

export type UpdatePreferenceInput = z.infer<typeof updatePreferenceSchema>;
