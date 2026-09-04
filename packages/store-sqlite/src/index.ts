import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readAnalytics, type AnalyticsSummary } from "./analytics.js";
import { createWorkflowStore } from "./workflow-store.js";
import type { WorkflowStore } from "./workflow-types.js";
export type {
  JsonValue,
  WorkflowStart,
  WorkflowStepResult,
  WorkflowRecord,
  WorkflowStore,
  WorkflowStage,
  WorkflowStatus,
  WorkflowDefinition,
  WorkflowHandlerContext,
} from "./workflow-types.js";
export { createWorkflowWorker } from "./workflow-worker.js";
export type { AnalyticsSummary } from "./analytics.js";
import {
  redactDecision,
  nextPoolPerson,
  redactSubmission,
  type DecisionStore,
  type FormSchema,
  type SubmissionRecord,
  type AssignmentStore,
  type AssignmentRequest,
  type AssignmentResult,
} from "@open-routing/core";

/** Local durable store; migrations are versioned with SQLite user_version. */
export function sqliteStore(
  filename: string,
  schema: FormSchema = {},
): DecisionStore &
  AssignmentStore & {
    close(): void;
    workflows: WorkflowStore;
    analytics(people?: readonly { id: string; name: string }[]): AnalyticsSummary;
  } {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  try {
    db.transaction(() => {
      const version = db.pragma("user_version", { simple: true }) as number;
      if (version > 4) throw new Error("Decision database is newer than this SDK");
      if (version === 0) {
        db.exec(`CREATE TABLE submissions (
      id TEXT PRIMARY KEY, received_at TEXT NOT NULL, status TEXT NOT NULL
      CHECK(status IN ('pending','completed','failed')), record_json TEXT NOT NULL
    );
    CREATE INDEX idx_submissions_received ON submissions(received_at DESC);
    CREATE INDEX idx_submissions_status_received ON submissions(status, received_at DESC);`);
      }
      if (version < 2) {
        db.exec(`CREATE TABLE assignments (
      idempotency_key TEXT PRIMARY KEY, result_json TEXT NOT NULL
    );
    CREATE TABLE pool_rotations (pool_id TEXT PRIMARY KEY, last_person_id TEXT NOT NULL);`);
        db.pragma("user_version = 2");
      }
      if (version < 3) {
        db.exec(`CREATE TABLE lead_workflows (
          id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pending','running','awaiting_approval','completed','failed')),
          available_at INTEGER NOT NULL, record_json TEXT NOT NULL
        );
        CREATE INDEX idx_workflows_ready ON lead_workflows(status, available_at);`);
        db.pragma("user_version = 3");
      }
      if (version < 4) {
        // One-time migration of the original contact-sales-specific record format.
        db.exec(
          "ALTER TABLE lead_workflows ADD COLUMN definition TEXT NOT NULL DEFAULT 'contact-sales-v1'; CREATE INDEX idx_workflows_definition_ready ON lead_workflows(definition, status, available_at);",
        );
        const rows = db.prepare("SELECT id, record_json FROM lead_workflows").all() as {
          id: string;
          record_json: string;
        }[];
        for (const row of rows) {
          const { research, ...legacy } = JSON.parse(row.record_json);
          const record = {
            ...legacy,
            definition: "contact-sales-v1",
            outputs: research ? { research } : {},
            resumeAt: legacy.status === "awaiting_approval" ? "crm" : null,
          };
          if (record.status === "running") {
            record.status = "pending";
            record.claimToken = null;
            record.leaseUntil = null;
          }
          db.prepare(
            "UPDATE lead_workflows SET status = ?, available_at = ?, record_json = ? WHERE id = ?",
          ).run(record.status, record.availableAt, JSON.stringify(record), row.id);
        }
        db.pragma("user_version = 4");
      }
    }).immediate();
  } catch (error) {
    db.close();
    throw error;
  }
  const getAssignment = (key: string): AssignmentResult | null => {
    const row = db
      .prepare("SELECT result_json FROM assignments WHERE idempotency_key = ?")
      .get(key) as { result_json: string } | undefined;
    return row ? (JSON.parse(row.result_json) as AssignmentResult) : null;
  };
  const getPoolCursor = (poolId: string): string | null => {
    const row = db
      .prepare("SELECT last_person_id FROM pool_rotations WHERE pool_id = ?")
      .get(poolId) as { last_person_id: string } | undefined;
    return row?.last_person_id ?? null;
  };
  const commitAssignment = db.transaction((request: AssignmentRequest): AssignmentResult => {
    const existing = getAssignment(request.idempotencyKey);
    if (existing) return existing;
    let result = redactDecision(schema, request.result);
    if (request.candidates?.length) {
      if (!result.poolId) throw new Error("A rotation requires a pool ID");
      const personId = nextPoolPerson(
        request.candidates.map((person) => person.id),
        getPoolCursor(result.poolId),
      );
      const person = request.candidates.find((person) => person.id === personId)!;
      const { reason: _reason, ...base } = result;
      result = {
        ...base,
        outcome: "assigned",
        personId: person.id,
        redirectUrl: person.bookingUrl,
      };
      db.prepare(
        "INSERT INTO pool_rotations (pool_id, last_person_id) VALUES (?, ?) ON CONFLICT(pool_id) DO UPDATE SET last_person_id = excluded.last_person_id",
      ).run(result.poolId, person.id);
    }
    db.prepare("INSERT INTO assignments (idempotency_key, result_json) VALUES (?, ?)").run(
      request.idempotencyKey,
      JSON.stringify(result),
    );
    // Return the serialized representation on both first calls and retries.
    return getAssignment(request.idempotencyKey)!;
  });
  const get = (id: string): SubmissionRecord | null => {
    const row = db.prepare("SELECT record_json FROM submissions WHERE id = ?").get(id) as
      | { record_json: string }
      | undefined;
    return row ? (JSON.parse(row.record_json) as SubmissionRecord) : null;
  };
  const update = (id: string, changes: Partial<SubmissionRecord>) => {
    const previous = get(id);
    if (!previous) throw new Error("Submission not found");
    if (previous.status !== "pending") throw new Error("Submission already finalized");
    const record = { ...previous, ...changes };
    db.prepare("UPDATE submissions SET status = ?, record_json = ? WHERE id = ?").run(
      record.status,
      JSON.stringify(record),
      id,
    );
  };
  return {
    workflows: createWorkflowStore(db, {
      getAssignment,
      getPoolCursor,
      commitAssignment: (request) => commitAssignment.immediate(request),
    }),
    analytics(people = []) {
      return db.transaction(() => readAnalytics(db, people))();
    },
    getPoolCursor,
    getAssignment,
    commitAssignment(request) {
      return commitAssignment.immediate(request);
    },
    create(record) {
      if (record.status !== "pending" || record.decision !== null || record.error !== null) {
        throw new Error("New submissions must be pending");
      }
      const safeRecord = { ...record, input: redactSubmission(schema, record.input) };
      db.prepare(
        "INSERT INTO submissions (id, received_at, status, record_json) VALUES (?, ?, ?, ?)",
      ).run(record.id, record.receivedAt, record.status, JSON.stringify(safeRecord));
    },
    complete(id, decision, durationMs) {
      update(id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        durationMs,
        decision: redactDecision(schema, decision),
        error: null,
      });
    },
    fail(id, error, durationMs) {
      update(id, { status: "failed", completedAt: new Date().toISOString(), durationMs, error });
    },
    get,
    list({ status, limit = 50, offset = 0 } = {}) {
      const where = status ? " WHERE status = ?" : "";
      const params = status ? [status] : [];
      const rows = db
        .prepare(
          `SELECT record_json FROM submissions${where} ORDER BY received_at DESC, rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, Math.min(100, Math.max(1, limit)), Math.max(0, offset)) as {
        record_json: string;
      }[];
      const count = db
        .prepare(`SELECT COUNT(*) AS total FROM submissions${where}`)
        .get(...params) as { total: number };
      return {
        records: rows.map((row) => JSON.parse(row.record_json) as SubmissionRecord),
        total: count.total,
      };
    },
    close() {
      db.close();
    },
  };
}

/** Kept for callers that only use submission logging. */
export function sqliteDecisionStore(filename: string, schema: FormSchema) {
  return sqliteStore(filename, schema);
}
