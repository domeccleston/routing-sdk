import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defineSchema, type SubmissionRecord, type AssignmentResult } from "@open-routing/core";
import { sqliteDecisionStore } from "../src/index.js";

const schema = defineSchema({
  email: { type: "email", privacy: "mask" },
  message: { type: "string", privacy: "omit" },
  company: { type: "string" },
});
const pending = (id: string): SubmissionRecord => ({
  id,
  receivedAt: new Date().toISOString(),
  completedAt: null,
  durationMs: null,
  status: "pending",
  configVersion: "test-config",
  input: {
    email: "secret@example.test",
    message: "private message",
    company: "Example",
    undeclared: "do not save",
  },
  decision: null,
  error: null,
});
const decision: AssignmentResult = {
  id: "decision-1",
  outcome: "unassigned",
  ruleId: "support",
  reason: "support_request",
  redirectUrl: "/success",
  facts: { company: { status: "not_found" }, ownership: { status: "company_not_found" } },
  warnings: [],
  trace: [
    {
      rule: "email-rule",
      matched: true,
      actual: "secret@example.test",
      condition: { field: "input.email", operator: "equals", value: "secret@example.test" },
    },
  ],
};
const stores: ReturnType<typeof sqliteDecisionStore>[] = [];
const dirs: string[] = [];
afterEach(() => {
  stores.forEach((s) => s.close());
  stores.length = 0;
  dirs.forEach((d) => rmSync(d, { recursive: true }));
  dirs.length = 0;
});
function memory() {
  const s = sqliteDecisionStore(":memory:", schema);
  stores.push(s);
  return s;
}

describe("SQLite decision store", () => {
  it("records a pending submission with privacy-filtered inputs", () => {
    const store = memory();
    store.create(pending("1"));
    expect(store.get("1")?.status).toBe("pending");
    expect(store.get("1")?.input).toEqual({ email: "[redacted]", company: "Example" });
  });
  it("stores outcome, destination and trace without duplicating raw inputs", () => {
    const store = memory();
    store.create(pending("1"));
    store.complete("1", decision, 25);
    const saved = store.get("1");
    expect(saved).toMatchObject({
      status: "completed",
      durationMs: 25,
      decision: { ruleId: "support", redirectUrl: "/success" },
    });
    expect(JSON.stringify(saved)).not.toContain("secret@example.test");
    expect(JSON.stringify(saved)).not.toContain("private message");
    expect(saved?.decision).not.toHaveProperty("input");
    expect(() => store.complete("1", decision, 30)).toThrow("already finalized");
  });
  it("records failures with safe codes and field names", () => {
    const store = memory();
    store.create(pending("1"));
    store.fail("1", { code: "invalid_submission", fields: ["email"] }, 2);
    expect(store.get("1")).toMatchObject({
      status: "failed",
      error: { code: "invalid_submission" },
      decision: null,
    });
  });
  it("filters and paginates newest-first, including equal timestamps", () => {
    const store = memory();
    store.create(pending("1"));
    store.create(pending("2"));
    store.fail("2", { code: "routing_failed" }, 1);
    expect(store.list({ limit: 1 }).records[0]?.id).toBe("2");
    expect(store.list({ offset: 1 }).records[0]?.id).toBe("1");
    expect(store.list({ status: "failed" }).total).toBe(1);
  });
  it("survives a database close and reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "routing-store-test-"));
    dirs.push(directory);
    const path = join(directory, "routing.sqlite");
    const first = sqliteDecisionStore(path, schema);
    first.create(pending("persistent"));
    first.close();
    const second = sqliteDecisionStore(path, schema);
    stores.push(second);
    expect(second.get("persistent")?.configVersion).toBe("test-config");
  });
});
