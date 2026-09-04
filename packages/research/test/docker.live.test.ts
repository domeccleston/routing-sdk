import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { createResearcher, docker, ResearchError } from "../src/index.js";

it.skipIf(process.env.RUN_RESEARCH_INTEGRATION_TESTS !== "1")(
  "cancels a running Docker session and removes its container",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "routing-docker-test-"));
    const controller = new AbortController();
    let sessionId = "";
    const sandbox = docker();
    const researcher = createResearcher({
      directory,
      agent: {
        env: {},
        command: [
          "node",
          "-e",
          "require('fs').writeFileSync('/work/started','yes'); setInterval(()=>{},1000)",
        ],
      },
      sandbox: {
        async run(options) {
          sessionId = options.id;
          await sandbox.run(options);
        },
      },
    });
    const running = researcher
      .run(
        {
          company: { domain: "example.com" },
          business: { description: "Test", icp: "Test" },
          assignment: {},
          routingPolicy: {},
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => error);
    try {
      const deadline = Date.now() + 15_000;
      let started = false;
      while (!started && Date.now() < deadline) {
        if (sessionId)
          started = await access(join(directory, sessionId, "started")).then(
            () => true,
            () => false,
          );
        if (!started) await delay(50);
      }
      expect(started).toBe(true);
      controller.abort();
      const error = await running;
      expect(error).toBeInstanceOf(ResearchError);
      expect(error).toMatchObject({ code: "cancelled", sessionId });
      await expect(
        promisify(execFile)("docker", ["inspect", `routing-research-${sessionId}`]),
      ).rejects.toThrow();
    } finally {
      controller.abort();
      await running;
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
