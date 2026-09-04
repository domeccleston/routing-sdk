import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssignmentResult } from "@open-routing/core";
import { sqliteStore } from "../src/index.js";

let store: ReturnType<typeof sqliteStore>;
beforeEach(() => {
  store = sqliteStore(":memory:");
});
afterEach(() => store.close());
function decision(id: string, changes: Partial<AssignmentResult> = {}): AssignmentResult {
  return {
    id,
    outcome: "assigned",
    personId: "a",
    redirectUrl: "https://example.com/book",
    facts: {
      company: {
        status: "found",
        company: {
          name: "Acme",
          domain: "acme.com",
          employeeCount: 100,
          country: "US",
          industry: "Software",
        },
      },
    },
    trace: [],
    warnings: [],
    ...changes,
  };
}
function log(id: string, result?: AssignmentResult) {
  store.create({
    id,
    receivedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    status: "pending",
    configVersion: "test",
    input: {},
    decision: null,
    error: null,
  });
  if (result) store.complete(id, result, 1);
}
function commit(result: AssignmentResult) {
  store.commitAssignment({ idempotencyKey: result.id, result });
}
describe("all-time analytics", () => {
  it("returns empty metrics and zero-assignment reps without claiming zero bookings", () => {
    const result = store.analytics([{ id: "a", name: "Amelia" }]);
    expect(result).toMatchObject({
      leads: 0,
      assigned: 0,
      enriched: 0,
      confirmedBookings: null,
      submissions: { total: 0, pending: 0, failed: 0 },
    });
    expect(result.reps).toEqual([
      { id: "a", name: "Amelia", assigned: 0, roundRobin: 0, direct: 0, confirmedBookings: null },
    ]);
  });
  it("counts assignments once across retries and logs, including assignments without logs", () => {
    const first = decision("one");
    commit(first);
    commit(first);
    log("attempt1", first);
    log("attempt2", first);
    commit(decision("two", { personId: "b", poolId: "sales" }));
    log("failed");
    store.fail("failed", { code: "invalid_submission" }, 1);
    log("pending");
    const result = store.analytics([
      { id: "a", name: "Amelia" },
      { id: "b", name: "Bob" },
    ]);
    expect(result).toMatchObject({
      leads: 2,
      assigned: 2,
      enriched: 2,
      submissions: { total: 4, pending: 1, failed: 1 },
    });
    expect(result.companies).toEqual([
      {
        name: "Acme",
        domain: "acme.com",
        employeeCount: 100,
        country: "US",
        industry: "software",
        leads: 2,
        assigned: 2,
      },
    ]);
    expect(result.reps).toMatchObject([
      { id: "a", direct: 1, roundRobin: 0 },
      { id: "b", direct: 0, roundRobin: 1 },
    ]);
    expect(result.industries).toEqual([{ label: "software", count: 2 }]);
    expect(
      store.analytics([
        { id: "a", name: "Amelia" },
        { id: "b", name: "Bob" },
      ]),
    ).toEqual(result);
    expect(store.getPoolCursor("sales")).toBeNull();
  });
  it("counts all records beyond pagination limits and preserves unknown enrichment", () => {
    for (let i = 0; i < 125; i++)
      commit(
        decision(String(i), {
          outcome: "unassigned",
          facts: { company: { status: "not_found" } },
        }),
      );
    const result = store.analytics();
    expect(result.leads).toBe(125);
    expect(result.assigned).toBe(0);
    expect(result.enriched).toBe(0);
    expect(result.sizes.find((item) => item.label === "Unknown")?.count).toBe(125);
    expect(result.industries).toEqual([{ label: "Unknown", count: 125 }]);
    expect(result.companies).toEqual([]);
  });
  it("uses enriched numeric headcount boundaries and counts partial profiles as unknown", () => {
    for (const [index, employeeCount] of [
      0,
      50,
      51,
      200,
      201,
      500,
      501,
      1000,
      1001,
      undefined,
      -1,
    ].entries()) {
      commit(
        decision(String(index), {
          facts: {
            company: {
              status: "found",
              company: employeeCount !== undefined ? { employeeCount } : {},
            },
          },
        }),
      );
    }
    expect(store.analytics().sizes.map((item) => item.count)).toEqual([2, 2, 2, 2, 1, 2]);
    expect(store.analytics().companies).toEqual([]);
  });
  it("includes legacy decision snapshots and historical reps without inventing assignment methods", () => {
    const legacy = {
      id: "old",
      outcome: "routed",
      target: { repId: "departed", repName: "Former rep", url: "https://example.com" },
      facts: {},
      trace: [],
      warnings: [],
    } as unknown as AssignmentResult;
    log("old1", legacy);
    log("old2", legacy);
    expect(store.analytics().reps).toEqual([
      {
        id: "departed",
        name: "Former rep",
        assigned: 1,
        roundRobin: 0,
        direct: 0,
        confirmedBookings: null,
      },
    ]);
    expect(store.analytics().leads).toBe(1);
  });
});
