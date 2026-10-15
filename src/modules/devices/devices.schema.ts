import { z } from 'zod';

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(5, 'Device token must be at least 5 characters'),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
});

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;
