import { execFile, spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ResearchSandbox } from "./types.js";

const exec = promisify(execFile);

export function docker(options: { image?: string } = {}): ResearchSandbox {
  return {
    async run({ id, directory, agent, signal }) {
      signal?.throwIfAborted();
      const name = `routing-research-${id}`;
      let removing: Promise<unknown> | undefined;
      const remove = () =>
        (removing ??= exec("docker", ["rm", "--force", name], { timeout: 15_000 }).catch(() => {}));
      // Create separately: cancellation cannot race ahead of container creation
      // and leave an agent running after the worker has released its lease.
      try {
        await exec(
          "docker",
          [
            "create",
            "--name",
            name,
            "--mount",
            `type=bind,source=${directory},target=/work`,
            ...Object.keys(agent.env).flatMap((key) => ["--env", key]),
            options.image ?? "open-routing-research:local",
            ...agent.command,
          ],
          { env: { ...process.env, ...agent.env }, timeout: 60_000 },
        );
        signal?.throwIfAborted();
        const log = await open(join(directory, "agent.log"), "w", 0o600);
        try {
          await new Promise<void>((accept, reject) => {
            const child = spawn("docker", ["start", "--attach", name], {
              stdio: ["ignore", log.fd, log.fd],
            });
            const abort = () => {
              child.kill("SIGTERM");
              void remove();
            };
            signal?.addEventListener("abort", abort, { once: true });
            child.once("error", reject);
            child.once("close", (code) => {
              signal?.removeEventListener("abort", abort);
              if (code === 0) accept();
              else reject(new Error("Agent exited unsuccessfully"));
            });
            if (signal?.aborted) abort();
          });
          signal?.throwIfAborted();
        } finally {
          await log.close();
        }
      } finally {
        await remove();
      }
    },
  };
}
