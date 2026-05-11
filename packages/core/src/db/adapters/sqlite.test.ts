import { describe, test, expect, afterEach } from 'bun:test';
import { SqliteAdapter } from './sqlite';
import { unlinkSync } from 'fs';
import { join } from 'path';

let currentDbPath = '';

function createTestDb(): SqliteAdapter {
  currentDbPath = join(
    import.meta.dir,
    `.test-sqlite-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  return new SqliteAdapter(currentDbPath);
}

/** Insert a parent codebase row to satisfy FK constraints */
async function insertCodebase(db: SqliteAdapter, id: string): Promise<void> {
  await db.query(`INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ($1, $2, $3)`, [
    id,
    `test-codebase-${id}`,
    '/tmp/test-cwd',
  ]);
}

describe('SqliteAdapter', () => {
  let db: SqliteAdapter;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    try {
      unlinkSync(currentDbPath);
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-wal');
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-shm');
    } catch {
      /* may not exist */
    }
  });

  describe('INSERT with RETURNING', () => {
    test('returns inserted row via native RETURNING', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string; status: string }>(
        `INSERT INTO remote_agent_isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        ['test-id', 'cb-1', 'issue', '1', 'worktree', '/tmp/test', 'issue-1', 'active']
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('test-id');
      expect(result.rows[0].status).toBe('active');
    });

    test('returns correct row on ON CONFLICT DO UPDATE', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // Insert initial row
      await db.query(
        `INSERT INTO remote_agent_isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['orig-id', 'cb-1', 'issue', '42', 'worktree', '/tmp/original', 'issue-42', 'active']
      );

      // Upsert with ON CONFLICT -- this is the scenario that was broken
      const result = await db.query<{ id: string; working_path: string; branch_name: string }>(
        `INSERT INTO remote_agent_isolation_environments
         (codebase_id, workflow_type, workflow_id, provider, working_path, branch_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (codebase_id, workflow_type, workflow_id) WHERE status = 'active'
         DO UPDATE SET
           working_path = EXCLUDED.working_path,
           branch_name = EXCLUDED.branch_name,
           status = 'active'
         RETURNING *`,
        ['cb-1', 'issue', '42', 'worktree', '/tmp/updated', 'issue-42-v2']
      );

      expect(result.rows).toHaveLength(1);
      // Must return the updated row, not a random/wrong row
      expect(result.rows[0].id).toBe('orig-id');
      expect(result.rows[0].working_path).toBe('/tmp/updated');
      expect(result.rows[0].branch_name).toBe('issue-42-v2');
    });
  });

  describe('placeholder conversion (#999 regression)', () => {
    test('$N inside SQL comments is treated as a placeholder — avoid $N in comments', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // A query with $1 and $2 as real params, but $3 only appears in a comment.
      // convertPlaceholders replaces ALL $N occurrences including inside comments,
      // producing 3 ? marks for only 2 params → SQLite error.
      const sql = `SELECT * FROM remote_agent_codebases WHERE id = $1 AND name = $2 -- $3 is not a real param`;
      await expect(db.query(sql, ['cb-1', 'test-codebase-cb-1'])).rejects.toThrow();
    });

    test('query succeeds when $N placeholders match param count', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string }>(
        `SELECT id FROM remote_agent_codebases WHERE id = $1 AND name = $2`,
        ['cb-1', 'test-codebase-cb-1']
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('cb-1');
    });
  });

  describe('UPDATE/DELETE with RETURNING', () => {
    test('throws error for UPDATE RETURNING', async () => {
      db = createTestDb();

      await expect(
        db.query(
          `UPDATE remote_agent_isolation_environments SET status = $1 WHERE id = $2 RETURNING *`,
          ['destroyed', 'test-id']
        )
      ).rejects.toThrow('does not support RETURNING clause on UPDATE/DELETE');
    });
  });

  describe('tasks migration & backfill (gated by PRAGMA user_version)', () => {
    test('creates remote_agent_tasks table and sets user_version >= 22 on fresh DB', async () => {
      db = createTestDb();
      const internalDb = (
        db as unknown as { db: { prepare: (sql: string) => { get: () => unknown } } }
      ).db;
      const userVersion = (
        internalDb.prepare('PRAGMA user_version').get() as {
          user_version: number;
        }
      ).user_version;
      // user_version is set after the gated backfill; on a fresh DB the
      // SELECT returns zero rows but the gate still fires to mark the
      // migration applied.
      expect(userVersion).toBeGreaterThanOrEqual(22);

      const tableExists = await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='remote_agent_tasks'`
      );
      expect(tableExists.rows).toHaveLength(1);
    });

    test('adds task_id column to remote_agent_conversations', async () => {
      db = createTestDb();
      const internalDb = (
        db as unknown as { db: { prepare: (sql: string) => { all: () => unknown } } }
      ).db;
      const cols = internalDb.prepare("PRAGMA table_info('remote_agent_conversations')").all() as {
        name: string;
      }[];
      expect(cols.some(c => c.name === 'task_id')).toBe(true);
    });

    test('idx_conversations_task_id index is created', async () => {
      db = createTestDb();
      const result = await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_conversations_task_id'`
      );
      expect(result.rows).toHaveLength(1);
    });

    test('compound workflow_runs indexes for taskSummarySelect are created', async () => {
      db = createTestDb();
      const result = await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name IN
         ('idx_workflow_runs_conv_started_at', 'idx_workflow_runs_parent_conv_started_at')`
      );
      expect(result.rows.length).toBe(2);
    });

    test('backfills one task per pre-existing visible conversation', async () => {
      // Simulate a pre-existing DB: open once to create schema, force
      // user_version=0, insert legacy conversations without task_id, then
      // reopen to re-trigger the gated backfill.
      db = createTestDb();
      await insertCodebase(db, 'cb-legacy');
      await db.query(
        `INSERT INTO remote_agent_conversations
         (id, platform_type, platform_conversation_id, codebase_id, task_id)
         VALUES ($1, 'web', 'leg-1', $2, NULL)`,
        ['conv-leg-1', 'cb-legacy']
      );
      // Wipe the existing tasks (created from the first open's backfill,
      // which sees no conversations on a brand-new DB) and rewind the gate.
      await db.query('DELETE FROM remote_agent_tasks');
      const internalDb = (db as unknown as { db: { run: (sql: string) => void } }).db;
      internalDb.run('UPDATE remote_agent_conversations SET task_id = NULL');
      internalDb.run('PRAGMA user_version = 0');
      await db.close();

      // Reopen — initSchema triggers the backfill again.
      db = new SqliteAdapter(currentDbPath);
      const tasks = await db.query<{ id: string; title: string; codebase_id: string | null }>(
        'SELECT id, title, codebase_id FROM remote_agent_tasks'
      );
      expect(tasks.rows).toHaveLength(1);
      expect(tasks.rows[0].codebase_id).toBe('cb-legacy');

      const conv = await db.query<{ task_id: string | null }>(
        'SELECT task_id FROM remote_agent_conversations WHERE id = $1',
        ['conv-leg-1']
      );
      expect(conv.rows[0].task_id).toBe(tasks.rows[0].id);
    });

    test('does NOT re-run backfill on subsequent opens (user_version gate is load-bearing)', async () => {
      // This test exists specifically to catch a regression in the
      // PRAGMA user_version < 22 gate. If a refactor breaks the gate, every
      // server restart would create one fresh task row per existing
      // conversation, producing duplicates proportional to restart count.
      db = createTestDb();
      await insertCodebase(db, 'cb-1');
      await db.query(
        `INSERT INTO remote_agent_conversations
         (id, platform_type, platform_conversation_id, codebase_id)
         VALUES ($1, 'web', 'leg-1', $2)`,
        ['conv-1', 'cb-1']
      );
      // Pretend the user_version stayed bumped and pre-existing conversations
      // are already assigned a task_id. A correct gate must not duplicate.
      await db.query(`INSERT INTO remote_agent_tasks (id, title) VALUES ($1, $2)`, [
        'existing-task',
        'Existing',
      ]);
      await db.query(`UPDATE remote_agent_conversations SET task_id = $1 WHERE id = $2`, [
        'existing-task',
        'conv-1',
      ]);
      await db.close();

      db = new SqliteAdapter(currentDbPath);
      const tasks = await db.query<{ id: string }>('SELECT id FROM remote_agent_tasks');
      // Only the originally inserted task should exist — no duplicates.
      expect(tasks.rows.map(r => r.id)).toEqual(['existing-task']);
    });
  });

  describe('datetime() chronological vs lexical comparison', () => {
    // Documents the SQLite-specific bug fixed in getActiveWorkflowRunByPath.
    // `started_at` is TEXT in "YYYY-MM-DD HH:MM:SS" format. Comparing it
    // directly to an ISO param "YYYY-MM-DDTHH:MM:SS.mmmZ" with `<` is
    // LEXICAL: char 11 is space (0x20) in the column vs T (0x54) in the
    // param, so every column value lex-sorts before every ISO param,
    // making the comparison ALWAYS true regardless of actual time.
    //
    // Wrapping both sides in datetime() forces chronological comparison.

    test('lexical comparison gives wrong answer for SQLite stored format vs ISO param', async () => {
      db = createTestDb();
      // Column-format value (afternoon) is chronologically AFTER the ISO
      // param (morning), but lex compares char-11 (space < T) → wrong.
      const result = await db.query<{ broken: number }>(
        `SELECT ('2026-04-14 12:00:00' < $1) AS broken`,
        ['2026-04-14T10:00:00.000Z']
      );
      // Expected by chronology: FALSE. Lex says: TRUE.
      expect(result.rows[0].broken).toBe(1);
    });

    test('datetime() wrap on both sides gives chronological comparison', async () => {
      db = createTestDb();
      const result = await db.query<{ correct: number }>(
        `SELECT (datetime('2026-04-14 12:00:00') < datetime($1)) AS correct`,
        ['2026-04-14T10:00:00.000Z']
      );
      // 12:00 < 10:00 is FALSE — datetime() comparison agrees with reality.
      expect(result.rows[0].correct).toBe(0);
    });

    test('datetime() handles equality across formats', async () => {
      db = createTestDb();
      const result = await db.query<{ equal: number }>(
        `SELECT (datetime('2026-04-14 10:00:00') = datetime($1)) AS equal`,
        ['2026-04-14T10:00:00.000Z']
      );
      expect(result.rows[0].equal).toBe(1);
    });
  });
});
