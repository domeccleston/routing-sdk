import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
async function run(name: string) {
  const { stdout } = await exec(process.execPath, ["--import", "tsx", "index.ts"], {
    cwd: fileURLToPath(new URL(`./${name}/`, import.meta.url)),
    env: { ...process.env, ATTIO_LIVE: "0", PDL_LIVE: "0", COMPANY_DOMAIN: "example.com" },
    timeout: 10_000,
  });
  return JSON.parse(stdout);
}

describe("standalone offline examples", () => {
  it("round-robin retries do not advance the cursor", async () => {
    expect(await run("round-robin")).toEqual({
      assigned: ["alice", "alice", "bob"],
      next: "alice",
    });
  });
  it("territories have independent rotations and a fallback", async () => {
    const results = await run("territories");
    expect(results.map((item: { person: string | null }) => item.person)).toEqual([
      "alice",
      "charlie",
      "bob",
      null,
    ]);
    expect(results[3].redirect).toBe("/success");
  });
  it("CRM ownership leaves the new-account pool untouched", async () => {
    expect(await run("crm-ownership")).toEqual({
      person: "bob",
      rule: "existing-owner",
      nextInPool: "alice",
    });
  });
  it("enrichment determines the segment", async () => {
    expect(await run("enrichment")).toMatchObject({
      person: "enterprise",
      company: { status: "found", company: { employeeCount: 750, country: "US" } },
    });
  });
  it("approval resumes the workflow without blocking a calendar URL", async () => {
    expect(await run("workflow-approval")).toEqual({
      calendar: "https://cal.com/dom-eccleston/30min",
      beforeReview: "awaiting_approval",
      afterReview: "completed",
    });
  });
});
