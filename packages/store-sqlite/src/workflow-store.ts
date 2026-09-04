import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AssignmentStore } from "@open-routing/core";
import type { JsonValue, WorkflowRecord, WorkflowStore } from "./workflow-types.js";

export function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Expected a positive safe integer");
  return value;
}

function serialize(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new Error("Expected JSON data");
    return item;
  });
  if (json === undefined) throw new Error("Expected JSON data");
  return json;
}

function validName(name: string) {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name)
  )
    throw new Error("Invalid workflow name");
}

export function createWorkflowStore(
  db: Database.Database,
  assignments: AssignmentStore,
): WorkflowStore {
  const get = (id: string): WorkflowRecord | null => {
    const row = db.prepare("SELECT record_json FROM lead_workflows WHERE id = ?").get(id) as
      | { record_json: string }
      | undefined;
    return row ? (JSON.parse(row.record_json) as WorkflowRecord) : null;
  };
  const save = (record: WorkflowRecord) => {
    db.prepare(`INSERT INTO lead_workflows (id, definition, status, available_at, record_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, available_at=excluded.available_at, record_json=excluded.record_json`).run(
      record.id,
      record.definition,
      record.status,
      record.status === "running" ? record.leaseUntil : record.availableAt,
      serialize(record),
    );
  };
  const owned = (id: string, token: string) => {
    const record = get(id);
    if (
      !record ||
      record.status !== "running" ||
      record.claimToken !== token ||
      record.leaseUntil! <= Date.now()
    ) {
      throw new Error("Workflow lease lost");
    }
    return record;
  };
  const release = (record: WorkflowRecord, status: WorkflowRecord["status"]) => {
    record.status = status;
    record.claimToken = null;
    record.leaseUntil = null;
    record.updatedAt = Date.now();
  };
  return {
    assignmentStore(context: JsonValue, start) {
      validName(start.definition);
      validName(start.initialStage);
      const { definition, initialStage } = start;
      const snapshot = JSON.parse(serialize(context)) as JsonValue;
      return {
        getAssignment: assignments.getAssignment,
        getPoolCursor: assignments.getPoolCursor,
        commitAssignment(request) {
          return db
            .transaction(() => {
              const assignment = assignments.commitAssignment(request);
              if (assignment instanceof Promise)
                throw new Error("Workflow requires a synchronous SQLite assignment store");
              if (!get(assignment.id)) {
                const now = Date.now();
                save({
                  id: assignment.id,
                  definition,
                  assignment,
                  context: snapshot,
                  stage: initialStage,
                  status: "pending",
                  outputs: {},
                  resumeAt: null,
                  resolution: null,
                  attempts: 0,
                  availableAt: now,
                  leaseUntil: null,
                  claimToken: null,
                  lastError: null,
                  createdAt: now,
                  updatedAt: now,
                });
              }
              return assignment;
            })
            .immediate();
        },
      };
    },
    get,
    list({ status, limit = 50, offset = 0 } = {}) {
      positiveInteger(limit);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid offset");
      const rows = db
        .prepare(
          `SELECT record_json FROM lead_workflows ${status ? "WHERE status = ?" : ""} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...(status ? [status] : []), Math.min(limit, 100), offset) as {
        record_json: string;
      }[];
      return rows.map((row) => JSON.parse(row.record_json) as WorkflowRecord);
    },
    claim({ leaseMs = 60_000, maxAttempts = 3, definition } = {}) {
      positiveInteger(leaseMs);
      positiveInteger(maxAttempts);
      return db
        .transaction(() => {
          const now = Date.now();
          // Expired claims count as attempts too, including workers that repeatedly crash.
          for (;;) {
            const row = db
              .prepare(
                `SELECT id FROM lead_workflows WHERE status IN ('pending', 'running') AND available_at <= ? ${definition ? "AND definition = ?" : ""} ORDER BY available_at, rowid LIMIT 1`,
              )
              .get(now, ...(definition ? [definition] : [])) as { id: string } | undefined;
            if (!row) return null;
            const record = get(row.id)!;
            if (record.attempts >= maxAttempts) {
              release(record, "failed");
              record.lastError = "Attempt limit reached";
              save(record);
              continue;
            }
            record.status = "running";
            record.attempts++;
            record.claimToken = randomUUID();
            record.leaseUntil = now + leaseMs;
            record.updatedAt = now;
            save(record);
            return record;
          }
        })
        .immediate();
    },
    renew(id, token, leaseMs) {
      positiveInteger(leaseMs);
      db.transaction(() => {
        const record = owned(id, token);
        record.leaseUntil = Date.now() + leaseMs;
        record.updatedAt = Date.now();
        save(record);
      }).immediate();
    },
    complete(id, token, result) {
      db.transaction(() => {
        const record = owned(id, token);
        if (!result || !["next", "wait", "complete"].includes(result.transition?.type))
          throw new Error("Invalid workflow result");
        serialize(result);
        if (result.transition.type !== "complete") {
          validName(result.transition.stage);
          if (
            result.transition.stage === record.stage ||
            Object.hasOwn(record.outputs, result.transition.stage)
          )
            throw new Error("Workflow steps cannot repeat");
        }
        record.outputs[record.stage] = result.output;
        if (result.transition.type === "wait") {
          record.resumeAt = result.transition.stage;
          release(record, "awaiting_approval");
        } else if (result.transition.type === "next") {
          record.stage = result.transition.stage;
          release(record, "pending");
        } else release(record, "completed");
        record.attempts = 0;
        record.lastError = null;
        record.availableAt = Date.now();
        save(record);
      }).immediate();
    },
    fail(id, token, error, { maxAttempts = 3, retryDelayMs = 5_000 } = {}) {
      positiveInteger(maxAttempts);
      positiveInteger(retryDelayMs);
      db.transaction(() => {
        const record = owned(id, token);
        release(record, record.attempts >= maxAttempts ? "failed" : "pending");
        record.lastError = error;
        record.availableAt = Date.now() + retryDelayMs;
        save(record);
      }).immediate();
    },
    resolve(id, resolution) {
      if (resolution === null) throw new Error("A resolution is required");
      serialize(resolution);
      db.transaction(() => {
        const record = get(id);
        if (!record || record.status !== "awaiting_approval")
          throw new Error("Workflow is not awaiting approval");
        record.resolution = resolution;
        if (!record.resumeAt) throw new Error("Missing resume step");
        record.stage = record.resumeAt;
        record.resumeAt = null;
        release(record, "pending");
        record.availableAt = Date.now();
        save(record);
      }).immediate();
    },
    retry(id) {
      db.transaction(() => {
        const record = get(id);
        if (!record || record.status !== "failed") throw new Error("Workflow is not failed");
        release(record, "pending");
        record.attempts = 0;
        record.availableAt = Date.now();
        save(record);
      }).immediate();
    },
  };
}
