import { z } from 'zod/v4';

export const delegationToken = z.string().min(20).describe('Short-lived delegation issued by nexus-chat-bridge');
export const idempotencyKey = z.string().min(1).max(128);
export const uuid = z.string().uuid();
