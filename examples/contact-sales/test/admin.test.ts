import { spawn, type ChildProcess } from "node:child_process";
import { get } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubmissionRecord, PoolState } from "@open-routing/core";

let child: ChildProcess;
let base: string;
let directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "routing-admin-test-"));
  child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("../src/server.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        PDL_API_KEY: "",
        PORT: "0",
        ROUTING_DB_PATH: join(directory, "routing.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Example server did not start")), 10000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Example server exited: ${code}`));
    });
    child.stdout?.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
  });
}, 15000);
afterAll(async () => {
  if (child?.exitCode === null)
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    });
  if (directory) rmSync(directory, { recursive: true });
});
const form = {
  fullName: "SDK integration test",
  workEmail: "secret@acme.example",
  companyName: "Test Company",
  companySize: "51-200",
  requestedSeats: "40",
  requestType: "sales",
  message: "never persist this message",
};
const submit = (input: Record<string, string>) =>
  fetch(`${base}/route`, { method: "POST", body: new URLSearchParams(input), redirect: "manual" });

describe("local admin and submission lifecycle", () => {
  it("serves empty analytics with honest booking metrics and local read-only protection", async () => {
    const page = await fetch(`${base}/admin/analytics`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain("Confirmed bookings");
    expect((await fetch(`${base}/admin/analytics.js`)).status).toBe(200);
    const response = await fetch(`${base}/admin/api/analytics`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const summary = await response.json();
    expect(summary.leads).toBe(0);
    expect(summary.confirmedBookings).toBeNull();
    expect(summary.reps).toHaveLength(4);
    expect((await fetch(`${base}/admin/api/analytics`, { method: "POST" })).status).toBe(403);
  });
  it("serves the pools page and read-only state without creating assignments", async () => {
    const page = await fetch(`${base}/admin/pools`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await page.text()).toContain("/admin/pools.js");
    expect((await fetch(`${base}/admin/pools.js`)).status).toBe(200);
    const response = await fetch(`${base}/admin/api/pools`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const initial = (await response.json()) as { pools: PoolState[] };
    expect(initial.pools).toHaveLength(4);
    expect(initial.pools.find((pool) => pool.poolId === "us-enterprise")).toMatchObject({
      name: "US Enterprise",
      lastAssignedPersonId: null,
      nextPersonId: "rep_amelia",
    });
    expect(await fetch(`${base}/admin/api/pools`).then((r) => r.json())).toEqual(initial);
    expect((await fetch(`${base}/admin/api/pools`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${base}/admin/api/submissions`).then((r) => r.json())).total).toBe(0);
  });
  it("exposes complete demo presets without recording a submission", async () => {
    const before = await fetch(`${base}/admin/api/submissions`).then((r) => r.json());
    const response = await fetch(`${base}/demo-scenarios`);
    expect(response.status).toBe(200);
    const scenarios = (await response.json()) as {
      input: Record<string, unknown>;
      expected: { outcome: string };
    }[];
    expect(scenarios).toHaveLength(6);
    expect(scenarios.every((s) => s.input.workEmail && s.input.requestedSeats)).toBe(true);
    expect(new Set(scenarios.map((s) => s.expected.outcome))).toEqual(
      new Set(["assigned", "unassigned"]),
    );
    const after = await fetch(`${base}/admin/api/submissions`).then((r) => r.json());
    expect(after.total).toBe(before.total);
  });
  it("serves the dashboard with no caching and a restrictive CSP", async () => {
    const response = await fetch(`${base}/admin`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  it("stores a completed decision before redirecting directly to Cal.com", async () => {
    const response = await submit(form);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://cal.com/dom-eccleston/30min");
    const records = (await fetch(`${base}/admin/api/submissions`).then((r) => r.json())) as {
      records: SubmissionRecord[];
    };
    expect(records.records[0]).toMatchObject({
      status: "completed",
      decision: { outcome: "assigned", ruleId: "existing-crm-owner" },
    });
    expect(JSON.stringify(records)).not.toContain("secret@acme.example");
    expect(JSON.stringify(records)).not.toContain(form.message);
  });
  it("records invalid input as failed and can filter failures", async () => {
    expect((await submit({ ...form, requestedSeats: "invalid" })).status).toBe(400);
    const page = (await fetch(`${base}/admin/api/submissions?status=failed`).then((r) =>
      r.json(),
    )) as { records: SubmissionRecord[]; total: number };
    expect(page.total).toBe(1);
    expect(page.records[0]?.error).toEqual({
      code: "invalid_submission",
      fields: ["requestedSeats"],
    });
  });
  it("preserves the success-page redirect", async () => {
    const response = await submit({ ...form, requestType: "support" });
    expect(response.headers.get("location")).toBe("/success.html");
  });
  it("issues form attempt keys and replays POSTs without consuming another pool turn", async () => {
    const html = await fetch(base).then((r) => r.text());
    const key = html.match(/name="_submissionId" value="([^"]+)"/)?.[1];
    expect(key).toBeTruthy();
    const input = { ...form, workEmail: "buyer@unowned.example", _submissionId: key! };
    const first = await submit(input);
    const retry = await submit(input);
    expect(first.status).toBe(303);
    expect(retry.headers.get("location")).toBe(first.headers.get("location"));
    const { records } = (await fetch(`${base}/admin/api/submissions`).then((r) => r.json())) as {
      records: SubmissionRecord[];
    };
    expect(records[0]?.decision).toEqual(records[1]?.decision);
    expect(records[0]?.decision).toMatchObject({ poolId: "us-enterprise", personId: "rep_amelia" });
    expect(records[0]?.input).not.toHaveProperty("_submissionId");
    const next = await fetch(`${base}/route`, {
      method: "POST",
      body: new URLSearchParams(input),
      headers: { "Idempotency-Key": "next-opportunity" },
      redirect: "manual",
    });
    expect(next.status).toBe(303);
    const page = (await fetch(`${base}/admin/api/submissions`).then((r) => r.json())) as {
      records: SubmissionRecord[];
    };
    expect(page.records[0]?.decision?.personId).toBe("rep_marcus");
  });
  it("updates pool state after assignment and keeps inspection read-only", async () => {
    const readPools = async () =>
      (await fetch(`${base}/admin/api/pools`).then((r) => r.json())) as { pools: PoolState[] };
    const before = (await readPools()).pools.find((pool) => pool.poolId === "us-enterprise")!;
    expect((await submit({ ...form, workEmail: "buyer@unowned.example" })).status).toBe(303);
    const after = await readPools();
    expect(after.pools.find((pool) => pool.poolId === "us-enterprise")?.lastAssignedPersonId).toBe(
      before.nextPersonId,
    );
    expect(await readPools()).toEqual(after);
  });
  it("reports company enrichment and rep totals without exposing raw submissions", async () => {
    const summary = await fetch(`${base}/admin/api/analytics`).then((r) => r.json());
    expect(summary.leads).toBeGreaterThan(0);
    expect(summary.enriched).toBeGreaterThan(0);
    expect(
      summary.companies.some((company: { domain: string }) => company.domain === "acme.example"),
    ).toBe(true);
    expect(summary.reps.some((rep: { assigned: number }) => rep.assigned > 0)).toBe(true);
    expect(summary.confirmedBookings).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("secret@acme.example");
    expect(JSON.stringify(summary)).not.toContain(form.message);
    expect(await fetch(`${base}/admin/api/analytics`).then((r) => r.json())).toEqual(summary);
  });
  it.each([
    "/admin/api/submissions",
    "/admin/api/pools",
    "/admin/pools",
    "/admin/api/analytics",
    "/admin/analytics",
  ])("rejects foreign host headers on %s", async (path) => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(`${base}${path}`, { headers: { Host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(status).toBe(403);
  });
});
