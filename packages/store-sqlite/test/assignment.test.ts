import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter, defineSchema, type RouterConfig } from "@open-routing/core";
import { sqliteStore } from "../src/index.js";

const schema = defineSchema({
  country: { type: "string", required: true },
  email: { type: "email", role: "person.email", privacy: "mask" },
});
const stores: ReturnType<typeof sqliteStore>[] = [];
const directories: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  directories.splice(0).forEach((d) => rmSync(d, { recursive: true }));
});
function open(path = ":memory:") {
  const store = sqliteStore(path, schema);
  stores.push(store);
  return store;
}
function path() {
  const directory = mkdtempSync(join(tmpdir(), "routing-assignment-test-"));
  directories.push(directory);
  return join(directory, "routing.sqlite");
}
function config(store = open()): RouterConfig<typeof schema> {
  return {
    schema,
    store,
    people: {
      a: { name: "A", bookingUrl: "https://cal.com/a/30min" },
      b: { name: "B", bookingUrl: "https://cal.com/b/30min" },
      c: { name: "C", bookingUrl: "https://example.com/c", active: false },
    },
    pools: {
      us: { members: ["a", "b", "c"], strategy: "round-robin" },
      uk: { members: ["a", "b"], strategy: "round-robin" },
    },
    rules: [
      { id: "us", when: { field: "input.country", equals: "US" }, assign: { pool: "us" } },
      { id: "uk", when: { field: "input.country", equals: "GB" }, assign: { pool: "uk" } },
    ],
    fallback: { redirect: "/success" },
  };
}
describe("durable lead assignment", () => {
  it("inspects all pools without changing their cursors or running enrichment", async () => {
    const options = config();
    const enrich = vi.fn();
    const router = createRouter({
      ...options,
      providers: { enrichment: { name: "unused", enrich } },
    });
    expect(await router.getPoolState("us")).toMatchObject({
      poolId: "us",
      lastAssignedPersonId: null,
      nextPersonId: "a",
      eligiblePersonIds: ["a", "b"],
      members: [
        { id: "a", active: true },
        { id: "b", active: true },
        { id: "c", active: false },
      ],
    });
    const before = await router.listPoolStates();
    expect(await router.listPoolStates()).toEqual(before);
    expect(enrich).not.toHaveBeenCalled();
    expect(await options.store.getPoolCursor("us")).toBeNull();
    await expect(router.getPoolState("missing")).rejects.toThrow("Unknown pool");
    expect(await createRouter({ ...options, pools: {}, rules: [] }).listPoolStates()).toEqual([]);
  });
  it("reports the same next person that assign selects, including changed membership", async () => {
    const options = config();
    const router = createRouter(options);
    const before = await router.getPoolState("us");
    const first = await router.assign({ country: "US" }, { idempotencyKey: "state-1" });
    expect(first.personId).toBe(before.nextPersonId);
    const after = await router.getPoolState("us");
    expect(after).toMatchObject({ lastAssignedPersonId: "a", nextPersonId: "b" });
    await router.assign({ country: "US" }, { idempotencyKey: "state-1" });
    expect(await router.getPoolState("us")).toEqual(after);
    expect((await router.getPoolState("uk")).lastAssignedPersonId).toBeNull();
    const changed = createRouter({
      ...options,
      people: { ...options.people, a: { ...options.people.a!, active: false } },
    });
    expect(await changed.getPoolState("us")).toMatchObject({
      lastAssignedPersonId: "a",
      nextPersonId: "b",
      eligiblePersonIds: ["b"],
    });
    expect((await changed.assign({ country: "US" }, { idempotencyKey: "state-2" })).personId).toBe(
      "b",
    );
    const inactive = createRouter({
      ...options,
      people: Object.fromEntries(
        Object.entries(options.people).map(([id, person]) => [id, { ...person, active: false }]),
      ),
    });
    expect(await inactive.getPoolState("us")).toMatchObject({
      lastAssignedPersonId: "b",
      nextPersonId: null,
      eligiblePersonIds: [],
    });
  });
  it("rotates in order, skips inactive people, and keeps pools independent", async () => {
    const router = createRouter(config());
    const people = [];
    for (const [i, country] of ["US", "US", "GB", "US", "GB"].entries()) {
      people.push((await router.assign({ country }, { idempotencyKey: String(i) })).personId);
    }
    expect(people).toEqual(["a", "b", "a", "a", "b"]);
  });
  it("deduplicates concurrent retries and returns the original result after config changes", async () => {
    const options = config();
    const router = createRouter(options);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        router.assign({ country: "US" }, { idempotencyKey: "same" }),
      ),
    );
    expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
    expect((await router.assign({ country: "US" }, { idempotencyKey: "next" })).personId).toBe("b");
    expect(
      await createRouter({ ...options, rules: [] }).assign(
        { country: "GB" },
        { idempotencyKey: "same" },
      ),
    ).toEqual(results[0]);
  });
  it("persists unassigned outcomes without advancing a rotation", async () => {
    const options = config();
    const router = createRouter(options);
    const result = await router.assign({ country: "FR" }, { idempotencyKey: "none" });
    expect(result).toMatchObject({
      outcome: "unassigned",
      reason: "no_matching_rule",
      redirectUrl: "/success",
    });
    expect(await router.assign({ country: "FR" }, { idempotencyKey: "none" })).toEqual(result);
    expect((await router.assign({ country: "US" }, { idempotencyKey: "first" })).personId).toBe(
      "a",
    );
    const unavailable = createRouter({
      ...options,
      people: Object.fromEntries(
        Object.entries(options.people).map(([id, person]) => [id, { ...person, active: false }]),
      ),
    });
    expect(
      await unavailable.assign({ country: "US" }, { idempotencyKey: "inactive" }),
    ).toMatchObject({ outcome: "unassigned", poolId: "us", reason: "no_active_members" });
    expect((await router.assign({ country: "US" }, { idempotencyKey: "second" })).personId).toBe(
      "b",
    );
  });
  it("routes CRM owners directly without consuming a pool turn", async () => {
    const options = config();
    const router = createRouter({
      ...options,
      providers: {
        ownership: {
          name: "test",
          async findOwner() {
            return {
              status: "owned",
              company: { id: "company", name: "Example", domains: ["example.com"] },
              owner: { id: "b", name: "B", email: "b@example.com" },
            };
          },
        },
      },
      rules: [
        {
          id: "owner",
          when: { field: "crm.owner.status", equals: "owned" },
          assign: { owner: true },
        },
        ...options.rules,
      ],
    });
    const result = await router.assign(
      { country: "US", email: "buyer@example.com" },
      { idempotencyKey: "owner" },
    );
    expect(result).toMatchObject({ personId: "b", ruleId: "owner" });
    expect(result.poolId).toBeUndefined();
    expect(
      (await createRouter(options).assign({ country: "US" }, { idempotencyKey: "first" })).personId,
    ).toBe("a");
  });
  it("falls through an ineligible CRM owner to the territory pool", async () => {
    const options = config();
    const router = createRouter({
      ...options,
      providers: {
        ownership: {
          name: "test",
          async findOwner() {
            return {
              status: "owned",
              company: { id: "company", name: "Example", domains: ["example.com"] },
              owner: { id: "c", name: "C", email: "c@example.com" },
            };
          },
        },
      },
      rules: [
        {
          id: "owner",
          when: { field: "crm.owner.status", equals: "owned" },
          assign: { owner: true },
        },
        ...options.rules,
      ],
    });
    expect(
      await router.assign(
        { country: "US", email: "buyer@example.com" },
        { idempotencyKey: "owner" },
      ),
    ).toMatchObject({ personId: "a", poolId: "us", warnings: ["crm_owner_not_eligible"] });
  });
  it("honors declaration order and all/any/numeric conditions", async () => {
    const options = config();
    const router = createRouter({
      ...options,
      schema: defineSchema({
        size: { type: "integer", required: true },
        country: { type: "string", required: true },
      }),
      rules: [
        {
          id: "enterprise",
          when: {
            all: [
              { field: "input.size", gte: 500 },
              { field: "input.size", lte: 1000 },
              { any: [{ field: "input.country", in: ["US", "GB"] }] },
            ],
          },
          assign: { person: "b" },
        },
        {
          id: "commercial",
          when: { field: "input.country", equals: "US" },
          assign: { person: "a" },
        },
      ],
    });
    for (const size of [499, 500, 1000, 1001]) {
      expect(
        (await router.assign({ size, country: "US" }, { idempotencyKey: String(size) })).personId,
      ).toBe(size >= 500 && size <= 1000 ? "b" : "a");
    }
  });
  it("preserves private field redaction in assignments and retries", async () => {
    const options = config();
    const router = createRouter({
      ...options,
      rules: [
        {
          id: "private",
          when: { field: "input.email", equals: "secret@example.com" },
          assign: { pool: "us" },
        },
      ],
    });
    const result = await router.assign(
      { country: "US", email: "secret@example.com" },
      { idempotencyKey: "private" },
    );
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
    expect(JSON.stringify(await options.store.getAssignment("private"))).not.toContain(
      "secret@example.com",
    );
  });
  it("fails closed when committing fails and does not call providers on replay", async () => {
    const options = config();
    const failing = createRouter({
      ...options,
      store: {
        getAssignment: () => null,
        getPoolCursor: () => null,
        commitAssignment: () => {
          throw new Error("disk full");
        },
      },
    });
    await expect(failing.assign({ country: "US" }, { idempotencyKey: "fail" })).rejects.toThrow(
      "disk full",
    );
    const enrich = vi.fn(async () => ({ status: "not_found" as const }));
    const router = createRouter({
      ...options,
      providers: { enrichment: { name: "test", enrich } },
    });
    await router.assign({ country: "US", email: "a@example.com" }, { idempotencyKey: "replay" });
    await router.assign({ country: "US", email: "a@example.com" }, { idempotencyKey: "replay" });
    expect(enrich).toHaveBeenCalledTimes(1);
  });
  it("validates pool references, duplicate members, destinations, and keys", async () => {
    const options = config();
    expect(() =>
      createRouter({
        ...options,
        pools: { bad: { strategy: "round-robin", members: ["missing"] } },
      }),
    ).toThrow("Unknown person");
    expect(() =>
      createRouter({ ...options, pools: { us: { strategy: "round-robin", members: ["a", "a"] } } }),
    ).toThrow("unique members");
    expect(() =>
      createRouter({ ...options, fallback: { redirect: "javascript:alert(1)" } }),
    ).toThrow();
    await expect(
      createRouter(options).assign({ country: "US" }, { idempotencyKey: "" }),
    ).rejects.toThrow("idempotency key");
  });
  it("resumes rotation and idempotency after reopening the database", async () => {
    const filename = path();
    const first = sqliteStore(filename, schema);
    const result = await createRouter(config(first)).assign(
      { country: "US" },
      { idempotencyKey: "first" },
    );
    first.close();
    const second = createRouter(config(open(filename)));
    expect(await second.getPoolState("us")).toMatchObject({
      lastAssignedPersonId: "a",
      nextPersonId: "b",
    });
    expect(await second.assign({ country: "US" }, { idempotencyKey: "first" })).toEqual(result);
    expect((await second.assign({ country: "US" }, { idempotencyKey: "second" })).personId).toBe(
      "b",
    );
  });
  it("upgrades a v1 database without changing existing submission records", () => {
    const filename = path();
    const db = new Database(filename);
    db.exec(
      "CREATE TABLE submissions (id TEXT PRIMARY KEY, received_at TEXT NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL); PRAGMA user_version = 1;",
    );
    db.prepare("INSERT INTO submissions VALUES (?, ?, ?, ?)").run(
      "old",
      "2026-01-01",
      "completed",
      JSON.stringify({
        id: "old",
        decision: { outcome: "routed", route: "legacy", target: { url: "https://example.com" } },
      }),
    );
    db.close();
    const store = open(filename);
    expect(store.get("old")).toMatchObject({ id: "old", decision: { route: "legacy" } });
    expect(store.getAssignment("old")).toBeNull();
  });
  it("rolls back the cursor if saving the result fails", async () => {
    const filename = path();
    const router = createRouter(config(open(filename)));
    const db = new Database(filename);
    try {
      db.exec(
        "CREATE TRIGGER reject_assignment BEFORE INSERT ON assignments BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
      );
      await expect(router.assign({ country: "US" }, { idempotencyKey: "failure" })).rejects.toThrow(
        "test failure",
      );
      expect(db.prepare("SELECT * FROM pool_rotations").all()).toEqual([]);
      db.exec("DROP TRIGGER reject_assignment");
      expect((await router.assign({ country: "US" }, { idempotencyKey: "retry" })).personId).toBe(
        "a",
      );
    } finally {
      db.close();
    }
  });
  it("serializes assignment across independent Node processes", async () => {
    const filename = path();
    open(filename);
    const code = `
      import { createRouter } from '@open-routing/core';
      import { sqliteStore } from '@open-routing/store-sqlite';
      const store = sqliteStore(process.argv[1]);
      const router = createRouter({ schema: {}, store,
        people: { a: { name: 'A', bookingUrl: 'https://example.com/a' }, b: { name: 'B', bookingUrl: 'https://example.com/b' } },
        pools: { sales: { members: ['a', 'b'], strategy: 'round-robin' } },
        rules: [{ id: 'all', when: { all: [] }, assign: { pool: 'sales' } }], fallback: { redirect: '/success' } });
      const results = [];
      for (let i = 0; i < 20; i++) results.push(await router.assign({}, { idempotencyKey: String(i) }));
      console.log(JSON.stringify(results)); store.close();`;
    const run = promisify(execFile);
    const outputs = await Promise.all(
      [1, 2, 3].map(() =>
        run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, filename]),
      ),
    );
    const results = outputs.map(({ stdout }) => JSON.parse(stdout));
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0].filter((r: { personId: string }) => r.personId === "a")).toHaveLength(10);
    const db = new Database(filename);
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM assignments").get()).toEqual({ count: 20 });
    } finally {
      db.close();
    }
  });
});
