/**
 * Pure helpers that map a workflow's declared `inputs:` metadata onto sensible
 * placeholder text and task-derived default values for the workflow runner's
 * argument input. Extracted from `TaskWorkflowRunner.tsx` so the per-type
 * branching is unit-testable in isolation — locks enum exhaustiveness and
 * the prefill semantics (PR URL > PR number > branch name) against silent
 * regressions when new `WorkflowInputType` values are added.
 */
import type { TaskDetailResponse, WorkflowListEntry } from './api';

export type WorkflowInputMetadata = NonNullable<WorkflowListEntry['workflow']['inputs']>[number];

export function formatInputType(type: WorkflowInputMetadata['type']): string {
  switch (type) {
    case 'pull_request':
      return 'Pull request';
    case 'branch':
      return 'Branch';
    case 'path':
      return 'Path';
    case 'issue':
      return 'Issue';
    case 'number':
      return 'Number';
    case 'text':
      return 'Text';
  }
}

export function getInputPlaceholder(input?: WorkflowInputMetadata): string {
  if (!input) return 'Workflow input / arguments';
  if (input.placeholder) return input.placeholder;
  switch (input.type) {
    case 'pull_request':
      return 'PR number or URL, e.g. 123 or https://github.com/owner/repo/pull/123';
    case 'branch':
      return 'Branch name, e.g. feat/task-container-workspace';
    case 'path':
      return 'File or directory path, e.g. .agents/plans/my-plan.md';
    case 'issue':
      return 'Issue number or URL, e.g. 456 or https://github.com/owner/repo/issues/456';
    case 'number':
      return 'Numeric input';
    case 'text':
      return 'Workflow input / arguments';
  }
}

export function getTaskDefaultForInput(
  task: TaskDetailResponse,
  input: WorkflowInputMetadata
): string {
  switch (input.type) {
    case 'pull_request':
      return task.pr_url ?? (task.pr_number !== null ? String(task.pr_number) : '');
    case 'branch':
      return task.branch_name ?? '';
    case 'path':
    case 'issue':
    case 'number':
    case 'text':
      return '';
  }
}

export function getTaskDefaultForInputs(
  task: TaskDetailResponse,
  inputs: readonly WorkflowInputMetadata[]
): string {
  const contextualInput = inputs.find(
    input => input.type === 'pull_request' || input.type === 'branch'
  );
  return contextualInput ? getTaskDefaultForInput(task, contextualInput) : '';
}
