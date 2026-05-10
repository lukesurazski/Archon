/**
 * Zod schemas for task container API endpoints.
 */
import { z } from '@hono/zod-openapi';
import { conversationSchema } from './conversation.schemas';
import { workflowRunSchema, workflowRunStatusSchema } from './workflow.schemas';

export const taskStatusSchema = z.enum(['active', 'archived']).openapi('TaskStatus');

export const taskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    codebase_id: z.string().nullable(),
    branch_name: z.string().nullable(),
    pr_url: z.string().nullable(),
    pr_number: z.number().nullable(),
    status: taskStatusSchema,
    created_at: z.string(),
    updated_at: z.string(),
    conversation_count: z.number(),
    latest_run_status: workflowRunStatusSchema.nullable(),
    latest_run_started_at: z.string().nullable(),
    last_activity_at: z.string().nullable(),
  })
  .openapi('Task');

export const taskDetailSchema = taskSchema
  .extend({
    conversations: z.array(conversationSchema),
    workflow_runs: z.array(workflowRunSchema),
  })
  .openapi('TaskDetail');

export const listTasksQuerySchema = z.object({
  codebaseId: z.string().optional(),
  // Default at the schema level so the route handler never needs to coerce
  // and the OpenAPI spec documents the default. Unknown values are rejected
  // by the enum — no silent coercion to 'active'.
  status: taskStatusSchema.optional().default('active'),
  // Query strings arrive as strings. Transform so invalid / out-of-range
  // values clamp to a safe default rather than 400-ing — this preserves the
  // hand-rolled behaviour that was here before the Zod migration. (Status
  // intentionally does NOT clamp — typos there are client bugs.)
  limit: z
    .string()
    .optional()
    .transform(value => {
      if (value === undefined || value === '') return 100;
      const n = Number(value);
      if (!Number.isFinite(n)) return 100;
      return Math.min(Math.max(1, Math.floor(n)), 500);
    }),
});

export const taskIdParamsSchema = z.object({ id: z.string() });

export const createTaskBodySchema = z
  .object({
    title: z.string().min(1).max(255),
    // Nullable mirrors updateTaskBodySchema and the underlying DB columns,
    // so a client can POST `{ "description": null }` to create a task with
    // an explicitly empty field rather than being forced to omit it. The DB
    // column is nullable; omission and `null` produce the same row.
    description: z.string().nullable().optional(),
    codebaseId: z.string().nullable().optional(),
    branchName: z.string().nullable().optional(),
    prUrl: z.string().nullable().optional(),
    prNumber: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .openapi('CreateTaskBody');

export const updateTaskBodySchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    branchName: z.string().nullable().optional(),
    prUrl: z.string().nullable().optional(),
    prNumber: z.number().int().positive().nullable().optional(),
    status: taskStatusSchema.optional(),
  })
  .strict()
  .openapi('UpdateTaskBody');

export const taskListResponseSchema = z.array(taskSchema).openapi('TaskListResponse');
