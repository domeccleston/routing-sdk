import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sqliteStore } from "@open-routing/store-sqlite";
import { createRouter, type RouterConfig } from "../src/index.js";

const config = {
  schema: { email: { type: "email", required: true } },
  people: {
    alice: { name: "Alice", bookingUrl: "https://cal.com/alice/demo" },
    bob: { name: "Bob", bookingUrl: "https://cal.com/bob/demo" },
  },
  pools: { sales: { members: ["alice", "bob"] } },
  rules: [{ id: "sales", assign: { pool: "sales" } }],
  fallback: { redirect: "/success" },
} as const;
const input = { email: "buyer@example.com" };
afterEach(() => vi.restoreAllMocks());

it("keeps explicit in-memory routers isolated", async () => {
  const first = createRouter({ ...config, database: ":memory:" });
  const second = createRouter({ ...config, database: ":memory:" });
  try {
    await first.assign(input, { idempotencyKey: "first" });
    expect((await first.getPoolState("sales")).nextPersonId).toBe("bob");
    expect((await second.getPoolState("sales")).nextPersonId).toBe("alice");
  } finally {
    await first.close();
    await second.close();
  }
});

it("persists assignments and rotation in the default database across restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "routing-default-"));
  const previous = process.cwd();
  let router: ReturnType<typeof createRouter<typeof config.schema>> | undefined;
  try {
    process.chdir(directory);
    router = createRouter(config);
    expect(existsSync(join(directory, ".data/routing.sqlite"))).toBe(true);
    const first = await router.assign(input, { idempotencyKey: "first" });
    expect(first.personId).toBe("alice");
    await router.close();
    await router.close();
    router = createRouter(config);
    expect(await router.assign(input, { idempotencyKey: "first" })).toEqual(first);
    expect((await router.assign(input, { idempotencyKey: "second" })).personId).toBe("bob");
  } finally {
    await router?.close();
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

it("supports an explicit path and closes the owned connection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "routing-path-"));
  const database = join(directory, "custom.sqlite");
  const router = createRouter({ ...config, database });
  try {
    expect(existsSync(database)).toBe(true);
    await router.close();
    await expect(router.getPoolState("sales")).rejects.toThrow();
  } finally {
    await router.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("supports direct assignment with no pools and an inline typed schema", async () => {
  const router = createRouter({
    schema: { email: { type: "email", required: true } },
    people: config.people,
    fallback: config.fallback,
    database: ":memory:",
    rules: [{ id: "direct", assign: { person: "alice" } }],
  });
  try {
    expect((await router.assign(input, { idempotencyKey: "first" })).personId).toBe("alice");
    expect(await router.listPoolStates()).toEqual([]);
    // @ts-expect-error Inline schema retains required email typing.
    router.parse satisfies (value: unknown) => { email: number };
  } finally {
    await router.close();
  }
});

it("does not close a caller-supplied store", async () => {
  const store = sqliteStore(":memory:");
  const close = vi.spyOn(store, "close");
  try {
    const router = createRouter({ ...config, store });
    await router.close();
    expect(close).not.toHaveBeenCalled();
    expect(store.getPoolCursor("sales")).toBeNull();
    expect(() =>
      createRouter({ ...config, store, database: ":memory:" } as unknown as RouterConfig<
        typeof config.schema
      >),
    ).toThrow("not both");
  } finally {
    store.close();
  }
});
