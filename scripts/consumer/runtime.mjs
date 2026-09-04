import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRouter } from "open-routing";
import { defineSchema } from "@open-routing/core";
import { sqliteStore } from "@open-routing/store-sqlite";
import { attio } from "@open-routing/attio";
import { pdl } from "@open-routing/pdl";
import { dashboardAsset } from "@open-routing/dashboard";
import { createResearcher, pi, docker, parallel } from "@open-routing/research";

const config = {
  schema: defineSchema({ email: { type: "email", required: true } }),
  people: {
    alice: { name: "Alice", bookingUrl: "https://cal.com/alice/demo" },
    bob: { name: "Bob", bookingUrl: "https://cal.com/bob/demo" },
  },
  pools: { sales: { members: ["alice", "bob"] } },
  rules: [{ id: "sales", assign: { pool: "sales" } }],
  fallback: { redirect: "/success" },
};
let router = createRouter(config);
try {
  const lead = { email: "buyer@example.com" };
  const first = await router.assign(lead, { idempotencyKey: "one" });
  assert.equal(first.personId, "alice");
  await router.close();
  router = createRouter(config);
  assert.deepEqual(await router.assign(lead, { idempotencyKey: "one" }), first);
  assert.equal((await router.assign(lead, { idempotencyKey: "two" })).personId, "bob");
} finally {
  await router.close();
}
const store = sqliteStore(":memory:");
store.close();
assert.equal(attio({ apiKey: "test-only" }).name, "attio");
assert.equal(pdl({ apiKey: "test-only" }).name, "pdl");
for (const path of [
  "/admin",
  "/admin/dashboard.css",
  "/admin/dashboard.js",
  "/admin/workflow-panel.js",
  "/admin/pools",
  "/admin/pools.js",
  "/admin/analytics",
  "/admin/analytics.js",
]) {
  assert((await readFile(dashboardAsset(path), "utf8")).length > 0, path);
}
assert.equal(dashboardAsset("/admin/../../package.json"), null);
assert.equal(typeof createResearcher, "function");
assert.equal(typeof pi, "function");
assert.equal(typeof docker, "function");
assert.equal(typeof parallel, "function");
const researchModule = import.meta.resolve("@open-routing/research");
assert.match(
  await readFile(new URL("../sandbox/Dockerfile", researchModule), "utf8"),
  /FROM node:/,
);
console.log(
  "Plain Node imports, SQLite persistence, dashboard assets, and research assets passed.",
);
