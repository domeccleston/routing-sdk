import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "@open-routing/core";
import {
  createWorkflowWorker,
  sqliteStore,
  type WorkflowDefinition,
  type WorkflowStepResult,
} from "../src/index.js";

const stores: ReturnType<typeof sqliteStore>[] = [];
const directories: string[] = [];
const start = { definition: "arbitrary-v1", initialStage: "collect" };
const next: WorkflowStepResult = {
  output: { fact: "example" },
  transition: { type: "next", stage: "publish" },
};
const wait: WorkflowStepResult = {
  output: { question: "Proceed?" },
  transition: { type: "wait", stage: "publish" },
};
const done: WorkflowStepResult = { output: { receipt: "saved" }, transition: { type: "complete" } };
function open(filename = ":memory:") {
  const store = sqliteStore(filename);
  stores.push(store);
  return store;
}
function file() {
  const dir = mkdtempSync(join(tmpdir(), "routing-workflow-test-"));
  directories.push(dir);
  return join(dir, "db.sqlite");
}
async function submit(store: ReturnType<typeof sqliteStore>, key = "lead", definition = start) {
  return createRouter({
    schema: {},
    store: store.workflows.assignmentStore({ domain: "example.com" }, definition),
    people: {
      a: { name: "A", bookingUrl: "https://cal.com/a" },
      b: { name: "B", bookingUrl: "https://cal.com/b" },
    },
    pools: { sales: { strategy: "round-robin", members: ["a", "b"] } },
    rules: [{ id: "all", when: { all: [] }, assign: { pool: "sales" } }],
    fallback: { redirect: "/success" },
  }).assign({}, { idempotencyKey: key });
}
function definition(): WorkflowDefinition {
  return {
    id: start.definition,
    steps: { collect: vi.fn(async () => next), publish: vi.fn(async () => done) },
  };
}
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => s.close());
  directories.splice(0).forEach((d) => rmSync(d, { recursive: true }));
});

describe("generic SQLite workflows", () => {
  it("queues once per assignment without consuming additional turns on retry", async () => {
    const store = open();
    const results = await Promise.all(Array.from({ length: 10 }, () => submit(store)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(store.workflows.list()).toHaveLength(1);
    expect(store.workflows.get(results[0]!.id)).toMatchObject({
      stage: "collect",
      definition: start.definition,
      outputs: {},
      assignment: { personId: "a" },
    });
    expect((await submit(store, "next")).personId).toBe("b");
  });
  it("does not backfill ordinary historical assignments", async () => {
    const store = open();
    store.commitAssignment({
      idempotencyKey: "old",
      result: {
        id: "old",
        outcome: "unassigned",
        redirectUrl: "/success",
        facts: {},
        trace: [],
        warnings: [],
      },
    });
    expect((await submit(store, "old")).id).toBe("old");
    expect(store.workflows.list()).toEqual([]);
  });
  it("rolls back assignment and rotation if queueing fails", async () => {
    const filename = file();
    const store = open(filename);
    const db = new Database(filename);
    try {
      db.exec(
        "CREATE TRIGGER fail_job BEFORE INSERT ON lead_workflows BEGIN SELECT RAISE(ABORT, 'queue failed'); END;",
      );
      await expect(submit(store)).rejects.toThrow("queue failed");
      expect(store.getAssignment("lead")).toBeNull();
      expect(store.getPoolCursor("sales")).toBeNull();
    } finally {
      db.close();
    }
  });
  it("claims exclusively across connections and filters by definition", async () => {
    const path = file();
    const one = open(path);
    const two = open(path);
    await submit(one);
    expect(two.workflows.claim({ definition: "different" })).toBeNull();
    const job = one.workflows.claim()!;
    expect(two.workflows.claim()).toBeNull();
    one.workflows.complete(job.id, job.claimToken!, next);
    expect(two.workflows.get(job.id)).toMatchObject({
      stage: "publish",
      outputs: { collect: next.output },
    });
  });
  it("fences expired workers and recovers their claims", async () => {
    vi.useFakeTimers();
    const store = open();
    await submit(store);
    const a = store.workflows.claim({ leaseMs: 100 })!;
    vi.advanceTimersByTime(100);
    const b = store.workflows.claim()!;
    expect(b.claimToken).not.toBe(a.claimToken);
    expect(b.attempts).toBe(2);
    expect(() => store.workflows.complete(a.id, a.claimToken!, next)).toThrow("lease lost");
    expect(() => store.workflows.renew(a.id, a.claimToken!, 100)).toThrow("lease lost");
    expect(() => store.workflows.fail(a.id, a.claimToken!, "error")).toThrow("lease lost");
    store.workflows.complete(b.id, b.claimToken!, next);
  });
  it("renews leases and bounds repeated crashes", async () => {
    vi.useFakeTimers();
    const store = open();
    await submit(store);
    const a = store.workflows.claim({ leaseMs: 100 })!;
    vi.advanceTimersByTime(50);
    store.workflows.renew(a.id, a.claimToken!, 100);
    vi.advanceTimersByTime(60);
    expect(store.workflows.claim()).toBeNull();
    vi.advanceTimersByTime(40);
    expect(store.workflows.claim({ maxAttempts: 1 })).toBeNull();
    expect(store.workflows.get(a.id)?.status).toBe("failed");
  });
  it("waits for application resolution then resumes the persisted step", async () => {
    const store = open();
    const decision = await submit(store);
    const job = store.workflows.claim()!;
    store.workflows.complete(job.id, job.claimToken!, wait);
    expect(store.workflows.claim()).toBeNull();
    store.workflows.resolve(job.id, { approved: false, reviewer: "operator" });
    expect(() => store.workflows.resolve(job.id, { approved: true })).toThrow();
    const resumed = store.workflows.claim()!;
    expect(resumed).toMatchObject({
      stage: "publish",
      resolution: { approved: false },
      outputs: { collect: wait.output },
    });
    store.workflows.complete(resumed.id, resumed.claimToken!, done);
    expect(store.workflows.get(job.id)?.status).toBe("completed");
    expect(store.getAssignment("lead")).toEqual(decision);
  });
  it("delays retries and supports explicit retry after failure", async () => {
    vi.useFakeTimers();
    const store = open();
    await submit(store);
    let job = store.workflows.claim()!;
    store.workflows.fail(job.id, job.claimToken!, "unavailable", {
      retryDelayMs: 100,
      maxAttempts: 2,
    });
    expect(store.workflows.claim()).toBeNull();
    vi.advanceTimersByTime(100);
    job = store.workflows.claim()!;
    store.workflows.fail(job.id, job.claimToken!, "unavailable", { maxAttempts: 2 });
    expect(store.workflows.get(job.id)?.status).toBe("failed");
    store.workflows.retry(job.id);
    expect(store.workflows.claim()?.attempts).toBe(1);
  });
  it("validates JSON, names and transitions without advancing", async () => {
    const store = open();
    await submit(store);
    const job = store.workflows.claim()!;
    expect(() => store.workflows.assignmentStore({ invalid: NaN }, start)).toThrow("JSON");
    expect(() =>
      store.workflows.assignmentStore({}, { ...start, initialStage: "__proto__" }),
    ).toThrow();
    expect(() =>
      store.workflows.complete(job.id, job.claimToken!, {
        output: null,
        transition: { type: "next", stage: "collect" },
      }),
    ).toThrow("repeat");
    expect(() =>
      store.workflows.complete(job.id, job.claimToken!, { ...next, output: NaN }),
    ).toThrow("JSON");
    expect(store.workflows.get(job.id)?.stage).toBe("collect");
  });
  it("migrates legacy research and approvals without changing assignment snapshots", () => {
    const path = file();
    const db = new Database(path);
    db.exec(
      "CREATE TABLE submissions (id TEXT PRIMARY KEY, received_at TEXT, status TEXT, record_json TEXT); CREATE TABLE assignments (idempotency_key TEXT PRIMARY KEY, result_json TEXT); CREATE TABLE pool_rotations (pool_id TEXT PRIMARY KEY, last_person_id TEXT); CREATE TABLE lead_workflows (id TEXT PRIMARY KEY, status TEXT, available_at INTEGER, record_json TEXT); PRAGMA user_version = 3;",
    );
    const legacy = {
      id: "legacy",
      stage: "notify",
      status: "awaiting_approval",
      assignment: { id: "a" },
      context: {},
      attempts: 0,
      leaseUntil: null,
      claimToken: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
      research: { brief: "Saved", sources: [], proposedChanges: [] },
      resolution: null,
      availableAt: 1,
    };
    db.prepare("INSERT INTO lead_workflows VALUES (?, ?, ?, ?)").run(
      legacy.id,
      legacy.status,
      1,
      JSON.stringify(legacy),
    );
    for (const status of ["running", "completed"]) {
      const record = {
        ...legacy,
        id: status,
        status,
        stage: "crm",
        claimToken: status === "running" ? "old-token" : null,
        leaseUntil: status === "running" ? Date.now() + 60_000 : null,
      };
      db.prepare("INSERT INTO lead_workflows VALUES (?, ?, ?, ?)").run(
        record.id,
        status,
        record.leaseUntil ?? 1,
        JSON.stringify(record),
      );
    }
    db.close();
    const store = open(path);
    expect(store.workflows.get("running")).toMatchObject({
      status: "pending",
      claimToken: null,
      leaseUntil: null,
      outputs: { research: legacy.research },
    });
    expect(store.workflows.get("completed")).toMatchObject({
      status: "completed",
      assignment: legacy.assignment,
      outputs: { research: legacy.research },
    });
    expect(store.workflows.get("legacy")).toMatchObject({
      definition: "contact-sales-v1",
      outputs: { research: legacy.research },
      resumeAt: "crm",
      assignment: { id: "a" },
    });
    store.workflows.resolve("legacy", { action: "keep-initial" });
    expect(store.workflows.claim()?.stage).toBe("crm");
  });
  it("resumes after reopen without rerunning completed work", async () => {
    const path = file();
    const first = sqliteStore(path);
    const decision = await submit(first);
    const job = first.workflows.claim()!;
    first.workflows.complete(job.id, job.claimToken!, next);
    first.close();
    const store = open(path);
    const def = definition();
    await createWorkflowWorker({ store: store.workflows, definition: def }).runOnce();
    expect(def.steps.collect).not.toHaveBeenCalled();
    expect(store.workflows.get(decision.id)?.outputs.publish).toEqual(done.output);
  });
  it("retries only failed steps with a stable key and sanitized errors", async () => {
    vi.useFakeTimers();
    const store = open();
    await submit(store);
    const def = definition();
    def.steps.publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret-key"))
      .mockResolvedValue(done);
    const worker = createWorkflowWorker({
      store: store.workflows,
      definition: def,
      retryDelayMs: 100,
    });
    await worker.runOnce();
    await worker.runOnce();
    expect(JSON.stringify(store.workflows.list())).not.toContain("secret-key");
    vi.advanceTimersByTime(100);
    await worker.runOnce();
    expect(def.steps.collect).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(def.steps.publish).mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
  });
  it("fails closed on unknown next steps and leaves other definitions alone", async () => {
    const store = open();
    await submit(store, "other", { ...start, definition: "other-v1" });
    const def = definition();
    const worker = createWorkflowWorker({
      store: store.workflows,
      definition: def,
      maxAttempts: 1,
    });
    expect(await worker.runOnce()).toBe(false);
    await submit(store);
    def.steps.collect = async () => ({
      output: null,
      transition: { type: "next", stage: "missing" },
    });
    await worker.runOnce();
    expect(store.workflows.list()[0]).toMatchObject({
      status: "failed",
      stage: "collect",
      outputs: {},
    });
  });
  it("heartbeats long work and aborts at its deadline", async () => {
    vi.useFakeTimers();
    const store = open();
    await submit(store);
    const def = definition();
    let signal: AbortSignal | undefined;
    def.steps.collect = async (ctx) => {
      signal = ctx.signal;
      return new Promise(() => {});
    };
    const worker = createWorkflowWorker({
      store: store.workflows,
      definition: def,
      leaseMs: 90,
      timeoutMs: 200,
      maxAttempts: 1,
    });
    const running = worker.runOnce();
    await vi.advanceTimersByTimeAsync(150);
    expect(store.workflows.claim()).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await running;
    expect(signal?.aborted).toBe(true);
    expect(store.workflows.list()[0]?.status).toBe("failed");
  });
  it("stops on shutdown and ignores late results", async () => {
    const store = open();
    await submit(store);
    const def = definition();
    let finish: (v: WorkflowStepResult) => void = () => {};
    def.steps.collect = async () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const controller = new AbortController();
    const worker = createWorkflowWorker({ store: store.workflows, definition: def });
    const running = worker.runOnce(controller.signal);
    await Promise.resolve();
    controller.abort();
    await running;
    finish(next);
    await Promise.resolve();
    expect(store.workflows.list()[0]?.outputs).toEqual({});
    await worker.run({ signal: controller.signal });
    expect(await worker.runOnce(controller.signal)).toBe(false);
  });
});
