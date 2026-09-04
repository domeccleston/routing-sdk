import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LeadHandlers } from "./lead-workflow.js";

type Report = Awaited<ReturnType<LeadHandlers["research"]>>;

export function parseResearchReport(value: unknown): Report {
  const report = value as Report | null;
  if (
    !report ||
    typeof report.brief !== "string" ||
    !report.brief.trim() ||
    !Array.isArray(report.sources) ||
    !report.sources.length ||
    !report.sources.every((source) => {
      try {
        const url = new URL(source);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    }) ||
    !Array.isArray(report.proposedChanges) ||
    !report.proposedChanges.every(
      (change) =>
        change &&
        typeof change.field === "string" &&
        change.field.trim() &&
        typeof change.reason === "string" &&
        change.reason.trim() &&
        "value" in change,
    )
  )
    throw new Error("Invalid research report");
  // Parsing ensures the same JSON contract as the durable workflow boundary.
  return JSON.parse(
    JSON.stringify({
      brief: report.brief,
      sources: report.sources,
      proposedChanges: report.proposedChanges,
    }),
  ) as Report;
}

/** Runs a real Pi session; the host does not orchestrate or cap tool iterations. */
export function piResearch(options: {
  model: string;
  openRouterApiKey: string;
  parallelApiKey: string;
  directory: string;
  image?: string;
}): LeadHandlers["research"] {
  if (!options.openRouterApiKey || !options.parallelApiKey)
    throw new Error("Research credentials required");
  return async ({ workflow, signal }) => {
    signal.throwIfAborted();
    const root = resolve(options.directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(root, "session-"));
    await writeFile(
      join(directory, "context.json"),
      JSON.stringify(
        {
          context: workflow.context,
          assignment: workflow.assignment,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const name = `routing-research-${randomUUID()}`;
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--mount",
        `type=bind,source=${directory},target=/work`,
        "--env",
        "OPENROUTER_API_KEY",
        "--env",
        "PARALLEL_API_KEY",
        options.image ?? "open-routing-research:local",
        "pi",
        "--provider",
        "openrouter",
        "--model",
        options.model,
        "--session",
        "/work/session.jsonl",
        "--mode",
        "json",
        "--print",
        "@/opt/research/prompt.md",
        "@/work/context.json",
      ],
      {
        env: {
          ...process.env,
          OPENROUTER_API_KEY: options.openRouterApiKey,
          PARALLEL_API_KEY: options.parallelApiKey,
        },
        // Pi persists the session itself. Don't echo tool output or provider errors
        // into the app logs, where they could expose sensitive research context.
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    const abort = () => {
      const stop = spawn("docker", ["stop", "--time", "2", name], { stdio: "ignore" });
      stop.on("error", () => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      await new Promise<void>((accept, reject) => {
        child.once("error", () => reject(new Error("Could not start Docker research sandbox")));
        child.once("close", (code) =>
          code === 0
            ? accept()
            : reject(new Error("Pi research session failed; inspect its local session artifact")),
        );
      });
      signal.throwIfAborted();
      return parseResearchReport(
        JSON.parse(await readFile(join(directory, "report.json"), "utf8")),
      );
    } finally {
      signal.removeEventListener("abort", abort);
      for (const key of [options.openRouterApiKey, options.parallelApiKey]) {
        log = log.replaceAll(key, "[REDACTED]");
      }
      await writeFile(join(directory, "agent.log"), log, { mode: 0o600 });
    }
  };
}
