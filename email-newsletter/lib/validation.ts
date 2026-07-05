import { z } from 'zod';

export const subscribeSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(254, 'Email too long')
    .transform((e) => e.toLowerCase().trim()),
  list: z
    .string()
    .min(1, 'List is required')
    .max(50, 'List name too long')
    .transform((l) => l.toLowerCase().trim()),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
