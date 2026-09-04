import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactDecision, redactSubmission, type DecisionStore, type FormSchema, type SubmissionRecord } from "@open-routing/core";

/** Local durable store; migrations are versioned with SQLite user_version. */
export function sqliteDecisionStore(filename: string, schema: FormSchema): DecisionStore & { close(): void } {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 1) throw new Error("Decision database is newer than this SDK");
  if (version === 0) db.transaction(() => {
    db.exec(`CREATE TABLE submissions (
      id TEXT PRIMARY KEY, received_at TEXT NOT NULL, status TEXT NOT NULL
      CHECK(status IN ('pending','completed','failed')), record_json TEXT NOT NULL
    );
    CREATE INDEX idx_submissions_received ON submissions(received_at DESC);
    CREATE INDEX idx_submissions_status_received ON submissions(status, received_at DESC);`);
    db.pragma("user_version = 1");
  })();
  const get = (id: string): SubmissionRecord | null => {
    const row = db.prepare("SELECT record_json FROM submissions WHERE id = ?").get(id) as { record_json: string } | undefined;
    return row ? JSON.parse(row.record_json) as SubmissionRecord : null;
  };
  const update = (id: string, changes: Partial<SubmissionRecord>) => {
    const previous = get(id);
    if (!previous) throw new Error("Submission not found");
    if (previous.status !== "pending") throw new Error("Submission already finalized");
    const record = { ...previous, ...changes };
    db.prepare("UPDATE submissions SET status = ?, record_json = ? WHERE id = ?")
      .run(record.status, JSON.stringify(record), id);
  };
  return {
    create(record) {
      if (record.status !== "pending" || record.decision !== null || record.error !== null) {
        throw new Error("New submissions must be pending");
      }
      const safeRecord = { ...record, input: redactSubmission(schema, record.input) };
      db.prepare("INSERT INTO submissions (id, received_at, status, record_json) VALUES (?, ?, ?, ?)")
        .run(record.id, record.receivedAt, record.status, JSON.stringify(safeRecord));
    },
    complete(id, decision, durationMs) {
      update(id, { status: "completed", completedAt: new Date().toISOString(), durationMs,
        decision: redactDecision(schema, decision), error: null });
    },
    fail(id, error, durationMs) {
      update(id, { status: "failed", completedAt: new Date().toISOString(), durationMs, error });
    },
    get,
    list({ status, limit = 50, offset = 0 } = {}) {
      const where = status ? " WHERE status = ?" : "";
      const params = status ? [status] : [];
      const rows = db.prepare(`SELECT record_json FROM submissions${where} ORDER BY received_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(...params, Math.min(100, Math.max(1, limit)), Math.max(0, offset)) as { record_json: string }[];
      const count = db.prepare(`SELECT COUNT(*) AS total FROM submissions${where}`).get(...params) as { total: number };
      return { records: rows.map((row) => JSON.parse(row.record_json) as SubmissionRecord), total: count.total };
    },
    close() { db.close(); },
  };
}
