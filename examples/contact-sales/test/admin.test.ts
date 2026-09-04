import { spawn, type ChildProcess } from "node:child_process";
import { get } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubmissionRecord } from "@open-routing/core";

let child: ChildProcess;
let base: string;
let directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "routing-admin-test-"));
  child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/server.ts", import.meta.url))], {
    env: { ...process.env, PORT: "0", ROUTING_DB_PATH: join(directory, "routing.sqlite") }, stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Example server did not start")), 10000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Example server exited: ${code}`)); });
    child.stdout?.on("data", chunk => {
      const match = String(chunk).match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
}, 15000);
afterAll(async () => {
  if (child?.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });
  if (directory) rmSync(directory, { recursive: true });
});
const form = { fullName: "SDK integration test", workEmail: "secret@acme.example", companyName: "Test Company",
  companySize: "51-200", requestedSeats: "40", requestType: "sales", message: "never persist this message" };
const submit = (input: Record<string, string>) => fetch(`${base}/route`, { method: "POST", body: new URLSearchParams(input), redirect: "manual" });

describe("local admin and submission lifecycle", () => {
  it("exposes complete demo presets without recording a submission", async () => {
    const before = await fetch(`${base}/admin/api/submissions`).then(r => r.json());
    const response = await fetch(`${base}/demo-scenarios`);
    expect(response.status).toBe(200);
    const scenarios = await response.json() as { input: Record<string, unknown>; expected: { outcome: string } }[];
    expect(scenarios).toHaveLength(6);
    expect(scenarios.every(s => s.input.workEmail && s.input.requestedSeats)).toBe(true);
    expect(new Set(scenarios.map(s => s.expected.outcome))).toEqual(new Set(["routed", "not_routed", "unresolved"]));
    const after = await fetch(`${base}/admin/api/submissions`).then(r => r.json());
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
    const records = await fetch(`${base}/admin/api/submissions`).then(r => r.json()) as { records: SubmissionRecord[] };
    expect(records.records[0]).toMatchObject({ status: "completed", decision: { outcome: "routed", route: "existing-crm-owner" } });
    expect(JSON.stringify(records)).not.toContain("secret@acme.example");
    expect(JSON.stringify(records)).not.toContain(form.message);
  });
  it("records invalid input as failed and can filter failures", async () => {
    expect((await submit({ ...form, requestedSeats: "invalid" })).status).toBe(400);
    const page = await fetch(`${base}/admin/api/submissions?status=failed`).then(r => r.json()) as { records: SubmissionRecord[]; total: number };
    expect(page.total).toBe(1);
    expect(page.records[0]?.error).toEqual({ code: "invalid_submission", fields: ["requestedSeats"] });
  });
  it("preserves the success-page redirect", async () => {
    const response = await submit({ ...form, requestType: "support" });
    expect(response.headers.get("location")).toBe("/success.html");
  });
  it("rejects foreign host headers on the admin API", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(`${base}/admin/api/submissions`, { headers: { Host: "attacker.example" } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(status).toBe(403);
  });
});
