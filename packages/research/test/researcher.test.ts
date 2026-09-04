import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResearcher,
  pi,
  parallel,
  ResearchError,
  type ResearchSandbox,
} from "../src/index.js";
import { parseReport } from "../src/researcher.js";

const report = {
  brief: "Useful company research",
  findings: [{ description: "Employee count unknown", sources: [] }],
  review: { status: "inconclusive", reason: "Missing country could change routing" },
};
const input = {
  company: { domain: "example.com" },
  business: { description: "Meetings", icp: "Software teams" },
  assignment: { personId: "rep_1" },
  routingPolicy: { ownerFirst: true },
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup(run?: ResearchSandbox["run"]) {
  const directory = await mkdtemp(join(tmpdir(), "routing-research-test-"));
  directories.push(directory);
  const sandbox = {
    run: vi.fn(
      run ??
        (async ({ directory }) => {
          await writeFile(join(directory, "report.json"), JSON.stringify(report));
        }),
    ),
  };
  const researcher = createResearcher({
    directory,
    sandbox,
    agent: pi({ provider: "openrouter", model: "test-model", apiKey: "model-secret" }),
    search: parallel({ apiKey: "search-secret" }),
    instructions: "Our custom ICP instructions",
  });
  return { directory, sandbox, researcher };
}
describe("research SDK", () => {
  it("composes adapters, supplies context, and saves an independently inspectable session", async () => {
    const { researcher, sandbox } = await setup();
    const first = await researcher.run(input);
    const second = await researcher.run(input);
    expect(first.session.id).not.toBe(second.session.id);
    expect(first).toMatchObject(report);
    const paths = researcher.session(first.session.id);
    expect(JSON.parse(await readFile(paths.result, "utf8"))).toEqual(first);
    expect(JSON.parse(await readFile(join(paths.directory, "context.json"), "utf8"))).toEqual(
      input,
    );
    const prompt = await readFile(join(paths.directory, "instructions.md"), "utf8");
    expect(prompt).toContain("Our custom ICP instructions");
    expect(prompt).toContain("node /work/search.mjs");
    expect(prompt).not.toContain("secret");
    expect(sandbox.run.mock.calls[0]![0].agent.env).toEqual({
      OPENROUTER_API_KEY: "model-secret",
      PARALLEL_API_KEY: "search-secret",
    });
  });
  it("allows another harness and optional search without Pi dependencies", async () => {
    const { directory, sandbox } = await setup();
    await createResearcher({
      directory,
      sandbox,
      agent: { command: ["another-agent"], env: {} },
    }).run(input);
    expect(sandbox.run.mock.calls[0]![0].agent.command).toEqual(["another-agent"]);
  });
  it("fails before launch when cancelled and sanitizes provider failures", async () => {
    const { researcher, sandbox } = await setup(async () => {
      throw new Error("model-secret provider body");
    });
    await expect(researcher.run(input, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(sandbox.run).not.toHaveBeenCalled();
    try {
      await researcher.run(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchError);
      expect(String(error)).not.toContain("secret");
      expect((error as ResearchError).code).toBe("execution_failed");
    }
  });
  it("rejects malformed agent output with an inspectable session ID", async () => {
    const { researcher } = await setup(async ({ directory }) => {
      await writeFile(join(directory, "report.json"), "not json");
    });
    await expect(researcher.run(input)).rejects.toMatchObject({
      code: "invalid_output",
      sessionId: expect.any(String),
    });
  });
  it.each(["report.json", "result.json"])(
    "never follows an agent-created %s symlink on the host",
    async (name) => {
      const { directory, researcher } = await setup(async ({ directory }) => {
        const target = join(directory, "..", "private.json");
        if (name !== "report.json")
          await writeFile(join(directory, "report.json"), JSON.stringify(report));
        await symlink(target, join(directory, name));
      });
      const target = join(directory, "private.json");
      await writeFile(target, JSON.stringify(report));
      await expect(researcher.run(input)).rejects.toMatchObject({ code: "invalid_output" });
      expect(await readFile(target, "utf8")).toBe(JSON.stringify(report));
    },
  );
  it("rejects path traversal when inspecting sessions", async () => {
    const { researcher } = await setup();
    expect(() => researcher.session("../secrets")).toThrow();
  });
  it("permits unknowns without fabricating sources and discards executable fields", () => {
    expect(
      parseReport({
        ...report,
        proposedChanges: [{ field: "owner" }],
        session: { id: "untrusted" },
      }),
    ).toEqual(report);
  });
  it.each([
    null,
    {},
    { ...report, brief: "" },
    { ...report, findings: [{ description: "fact", sources: ["javascript:alert(1)"] }] },
    { ...report, findings: [{ description: "fact", sources: ["https://secret@example.com"] }] },
    { ...report, review: { status: "approve", reason: "x" } },
  ])("rejects invalid report %#", (value) => {
    expect(() => parseReport(value)).toThrow();
  });
  it("requires explicit credentials and supports custom Pi provider env keys", () => {
    expect(() => parallel({ apiKey: "" })).toThrow();
    expect(() => pi({ provider: "unknown", model: "m", apiKey: "k" })).toThrow();
    expect(
      pi({ provider: "custom", model: "m", apiKey: "k", apiKeyEnv: "CUSTOM_KEY" }).env,
    ).toEqual({ CUSTOM_KEY: "k" });
  });
});
