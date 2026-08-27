import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { AppError, appError } from '../errors.js';
import type { CommandContext } from './context.js';
import { ItemPrioritySchema, type ProductionItemPatch } from './contracts.js';
import { executeIdempotentCommand } from './idempotency.js';
import { updateProductionItem, type ProductionItem } from './items.js';

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true }).nullable();
const itemSchema = z.object({
  itemId: uuid,
  version: z.number().int().positive()
}).strict();
const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reassign'),
    assigneeUserId: uuid.nullable()
  }).strict(),
  z.object({
    type: z.literal('priority'),
    priority: ItemPrioritySchema
  }).strict(),
  z.object({
    type: z.literal('reschedule'),
    startsAt: instant.optional(),
    dueAt: instant.optional()
  }).strict()
]);
const batchSchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  action: actionSchema,
  idempotencyKey: z.string().trim().min(1).max(128)
}).strict().superRefine((batch, context) => {
  if (new Set(batch.items.map((item) => item.itemId)).size !== batch.items.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'Batch item IDs must be unique'
    });
  }
  if (
    batch.action.type === 'reschedule' &&
    batch.action.startsAt === undefined &&
    batch.action.dueAt === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action'],
      message: 'Reschedule action must include startsAt or dueAt'
    });
  }
});

export type ProductionBatchInput = z.input<typeof batchSchema>;
export type ProductionBatchAction = z.output<typeof actionSchema>;

export type ProductionBatchItemResult =
  | { itemId: string; ok: true; item: ProductionItem }
  | {
    itemId: string;
    ok: false;
    error: {
      code: string;
      status: number;
      message: string;
      currentVersion?: number;
    };
  };

export interface ProductionBatchResult {
  results: ProductionBatchItemResult[];
  succeeded: number;
  failed: number;
}

function patchFor(action: ProductionBatchAction): ProductionItemPatch {
  switch (action.type) {
    case 'reassign':
      return { assigneeUserId: action.assigneeUserId };
    case 'priority':
      return { priority: action.priority };
    case 'reschedule':
      return {
        ...(action.startsAt === undefined ? {} : { startsAt: action.startsAt }),
        ...(action.dueAt === undefined ? {} : { dueAt: action.dueAt })
      };
  }
}

function itemIdempotencyKey(
  batchKey: string,
  itemId: string,
  version: number,
  action: ProductionBatchAction
): string {
  return `batch-${createHash('sha256')
    .update(JSON.stringify({ batchKey, itemId, version, action }))
    .digest('hex')}`;
}

function safeFailure(itemId: string, error: AppError): ProductionBatchItemResult {
  const currentVersion = error.details && typeof error.details === 'object'
    ? (error.details as { currentVersion?: unknown }).currentVersion
    : undefined;
  return {
    itemId,
    ok: false,
    error: {
      code: error.code,
      status: error.status,
      message: error.message,
      ...(typeof currentVersion === 'number' ? { currentVersion } : {})
    }
  };
}

export async function executeProductionBatch(
  context: CommandContext,
  input: ProductionBatchInput
): Promise<ProductionBatchResult> {
  authorize(context.actor, 'item.batch');
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    throw appError('validation_error', 400, 'Production batch validation failed', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message
      }))
    });
  }
  const orderedItems = [...parsed.data.items]
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  const payload = { items: orderedItems, action: parsed.data.action };

  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => executeIdempotentCommand(
      client,
      context,
      'campaign_item.batch',
      parsed.data.idempotencyKey,
      payload,
      async () => {
        const results: ProductionBatchItemResult[] = [];
        for (const item of orderedItems) {
          try {
            const updated = await updateProductionItem(
              context,
              item.itemId,
              item.version,
              {
                ...patchFor(parsed.data.action),
                idempotencyKey: itemIdempotencyKey(
                  parsed.data.idempotencyKey,
                  item.itemId,
                  item.version,
                  parsed.data.action
                )
              }
            );
            results.push({ itemId: item.itemId, ok: true, item: updated });
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            results.push(safeFailure(item.itemId, error));
          }
        }
        const succeeded = results.filter((result) => result.ok).length;
        return { results, succeeded, failed: results.length - succeeded };
      }
    )
  );
}
