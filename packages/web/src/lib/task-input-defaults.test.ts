import { describe, test, expect } from 'bun:test';
import {
  formatInputType,
  getInputPlaceholder,
  getTaskDefaultForInput,
  getTaskDefaultForInputs,
  type WorkflowInputMetadata,
} from './task-input-defaults';
import type { TaskDetailResponse } from './api';

// Minimal task fixture — the helpers only touch pr_url / pr_number / branch_name.
function makeTask(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    id: 't1',
    title: 'Test task',
    description: null,
    codebase_id: null,
    branch_name: null,
    pr_url: null,
    pr_number: null,
    status: 'active',
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
    conversation_count: 0,
    latest_run_status: null,
    latest_run_started_at: null,
    last_activity_at: null,
    conversations: [],
    workflow_runs: [],
    ...overrides,
  };
}

describe('formatInputType', () => {
  // Locks every variant of the WorkflowInputType enum. If a new variant is
  // added (e.g. 'commit') and `formatInputType` isn't updated, TypeScript
  // catches the missing case at the switch site AND this test catches the
  // runtime behaviour gap.
  test.each([
    ['pull_request', 'Pull request'],
    ['branch', 'Branch'],
    ['path', 'Path'],
    ['issue', 'Issue'],
    ['number', 'Number'],
    ['text', 'Text'],
  ])('maps %s → %s', (input, expected) => {
    expect(formatInputType(input as WorkflowInputMetadata['type'])).toBe(expected);
  });
});

describe('getInputPlaceholder', () => {
  test('returns generic placeholder when input is undefined', () => {
    expect(getInputPlaceholder()).toBe('Workflow input / arguments');
  });

  test('prefers author-declared placeholder when provided', () => {
    const input: WorkflowInputMetadata = {
      name: 'pr',
      type: 'pull_request',
      placeholder: 'My custom hint',
    };
    expect(getInputPlaceholder(input)).toBe('My custom hint');
  });

  test('returns a per-type default when no placeholder is declared', () => {
    expect(getInputPlaceholder({ name: 'pr', type: 'pull_request' })).toContain('PR number');
    expect(getInputPlaceholder({ name: 'b', type: 'branch' })).toContain('Branch name');
    expect(getInputPlaceholder({ name: 'p', type: 'path' })).toContain('path');
    expect(getInputPlaceholder({ name: 'i', type: 'issue' })).toContain('Issue number');
    expect(getInputPlaceholder({ name: 'n', type: 'number' })).toContain('Numeric');
    expect(getInputPlaceholder({ name: 't', type: 'text' })).toBe('Workflow input / arguments');
  });
});

describe('getTaskDefaultForInput', () => {
  const taskWithPr = makeTask({
    pr_url: 'https://github.com/owner/repo/pull/1',
    pr_number: 1,
    branch_name: 'feat/x',
  });

  test('pull_request prefers pr_url over pr_number', () => {
    expect(getTaskDefaultForInput(taskWithPr, { name: 'pr', type: 'pull_request' })).toBe(
      'https://github.com/owner/repo/pull/1'
    );
  });

  test('pull_request falls back to pr_number when pr_url is null', () => {
    const task = makeTask({ pr_url: null, pr_number: 42 });
    expect(getTaskDefaultForInput(task, { name: 'pr', type: 'pull_request' })).toBe('42');
  });

  test('pull_request returns empty when both pr_url and pr_number are null', () => {
    expect(getTaskDefaultForInput(makeTask(), { name: 'pr', type: 'pull_request' })).toBe('');
  });

  test('branch returns task.branch_name', () => {
    expect(getTaskDefaultForInput(taskWithPr, { name: 'b', type: 'branch' })).toBe('feat/x');
  });

  test('branch returns empty when task.branch_name is null', () => {
    expect(getTaskDefaultForInput(makeTask(), { name: 'b', type: 'branch' })).toBe('');
  });

  test('non-contextual types return empty string', () => {
    const task = makeTask({
      pr_url: 'https://github.com/owner/repo/pull/1',
      branch_name: 'feat/x',
    });
    expect(getTaskDefaultForInput(task, { name: 'p', type: 'path' })).toBe('');
    expect(getTaskDefaultForInput(task, { name: 'i', type: 'issue' })).toBe('');
    expect(getTaskDefaultForInput(task, { name: 'n', type: 'number' })).toBe('');
    expect(getTaskDefaultForInput(task, { name: 't', type: 'text' })).toBe('');
  });
});

describe('getTaskDefaultForInputs', () => {
  const task = makeTask({
    pr_url: 'https://github.com/owner/repo/pull/1',
    branch_name: 'feat/x',
  });

  test('returns empty when no contextual input present', () => {
    expect(
      getTaskDefaultForInputs(task, [
        { name: 'p', type: 'path' },
        { name: 'n', type: 'number' },
      ])
    ).toBe('');
  });

  test('finds the first contextual input (pull_request or branch)', () => {
    expect(
      getTaskDefaultForInputs(task, [
        { name: 'p', type: 'path' },
        { name: 'pr', type: 'pull_request' },
      ])
    ).toBe('https://github.com/owner/repo/pull/1');
  });

  test('falls through to branch when pull_request input is not present', () => {
    expect(
      getTaskDefaultForInputs(task, [
        { name: 'p', type: 'path' },
        { name: 'b', type: 'branch' },
      ])
    ).toBe('feat/x');
  });

  test('empty inputs list returns empty string', () => {
    expect(getTaskDefaultForInputs(task, [])).toBe('');
  });
});
