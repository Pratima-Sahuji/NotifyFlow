import { z } from 'zod';

export const createEventSchema = z.object({
  eventType: z.string().min(1, 'eventType is required'),
  title: z.string().min(1, 'title is required').max(255),
  body: z.string().min(1, 'body is required'),
  recipients: z.array(z.string().min(1)).min(1, 'At least one recipient userId is required'),
  channels: z
    .array(z.enum(['websocket', 'fcm', 'email']))
    .default(['websocket', 'fcm']),
  priority: z.enum(['low', 'normal', 'important', 'urgent']).default('normal'),
  data: z.record(z.any()).default({}),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
