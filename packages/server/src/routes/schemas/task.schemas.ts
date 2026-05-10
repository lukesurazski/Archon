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
  status: taskStatusSchema.optional(),
  limit: z.string().optional(),
});

export const taskIdParamsSchema = z.object({ id: z.string() });

export const createTaskBodySchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    codebaseId: z.string().optional(),
    branchName: z.string().optional(),
    prUrl: z.string().optional(),
    prNumber: z.number().int().positive().optional(),
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
