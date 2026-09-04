import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SubmissionValidationError,
  redactSubmission,
  type DecisionStore,
} from "@open-routing/core";
import { sqliteStore, createWorkflowWorker } from "@open-routing/store-sqlite";
import { pdl } from "@open-routing/pdl";
import { dashboardAsset } from "@open-routing/dashboard";
import { createContactSalesRouter, contactSalesSchema } from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";
import reps from "../fixtures/routing/reps.json" with { type: "json" };
import territories from "../fixtures/routing/territories.json" with { type: "json" };
import { fixtureResearchHandlers } from "../fixtures/research.js";
import { createLeadWorkflow, leadWorkflow, leadWorkflowStart } from "./lead-workflow.js";
import { createDemoAttio } from "../fixtures/attio-client.js";
import { updateAttio } from "./update-attio.js";
import { liveAttio } from "./live-attio.js";
import { fixtureEnrichment, liveTestEnrichment } from "../fixtures/providers.js";
import { salesResearch } from "./research.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const live = process.env.ATTIO_LIVE === "1" ? liveAttio() : null;
const liveResearch = process.env.RESEARCH_LIVE === "1";
const researchHandler = liveResearch
  ? salesResearch({
      directory: fileURLToPath(new URL("../.data/research", import.meta.url)),
      model: process.env.RESEARCH_MODEL ?? "openai/gpt-5.6-luna",
      openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
      parallelApiKey: process.env.PARALLEL_API_KEY ?? "",
    })
  : fixtureResearchHandlers.research;
const workflowStart = liveResearch
  ? {
      definition: live ? "contact-sales-attio-research-v1" : "contact-sales-research-v1",
      initialStage: "research",
    }
  : live
    ? { definition: "contact-sales-attio-v1", initialStage: "research" }
    : leadWorkflowStart;
const configVersion = createHash("sha256")
  .update(
    ["../router.config.ts", "../fixtures/routing/territories.json", "../fixtures/routing/reps.json"]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n"),
  )
  .digest("hex");
const store = sqliteStore(
  process.env.ROUTING_DB_PATH ?? fileURLToPath(new URL("../.data/routing.sqlite", import.meta.url)),
  contactSalesSchema,
);
const enrichment = liveTestEnrichment(
  process.env.PDL_API_KEY ? pdl({ apiKey: process.env.PDL_API_KEY }) : fixtureEnrichment,
);
const router = createContactSalesRouter(store, enrichment, live?.ownership);
const adminToken = randomUUID();
const shutdown = new AbortController();
const worker = createWorkflowWorker({
  store: store.workflows,
  definition: createLeadWorkflow(
    {
      ...fixtureResearchHandlers,
      research: researchHandler,
      crm: live
        ? updateAttio(live.client, { memberIds: live.memberIds })
        : updateAttio(createDemoAttio().client),
    },
    workflowStart.definition,
  ),
  maxAttempts: 1,
  ...(liveResearch ? { timeoutMs: 30 * 60_000 } : {}),
});
function persist(write: (store: DecisionStore) => void) {
  try {
    if (store) write(store);
  } catch {
    console.error(JSON.stringify({ event: "routing.persistence_failed" }));
  }
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > 65536) throw new Error("Submission too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/demo-scenarios") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(routingCases));
    return;
  }
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    // Local-only admin: reject foreign Host headers (including DNS rebinding).
    if (!["localhost", "127.0.0.1"].includes((request.headers.host ?? "").split(":")[0] ?? "")) {
      response.writeHead(403).end("Local dashboard only");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
    );
    const actionMatch = url.pathname.match(
      /^\/admin\/api\/workflows\/([a-zA-Z0-9-]+)\/(resolve|retry)$/,
    );
    if (request.method === "POST" && actionMatch) {
      // Local capability token + exact Origin prevent cross-site requests from mutating state.
      // This is a single-user local demo, not production authentication.
      if (
        request.headers.origin !== `http://${request.headers.host}` ||
        request.headers["x-admin-token"] !== adminToken ||
        request.headers["content-type"] !== "application/json"
      ) {
        response.writeHead(403).end("Local action denied");
        return;
      }
      try {
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("Invalid body");
        const id = actionMatch[1]!;
        if (!store.workflows.get(id)) {
          response.writeHead(404).end("Workflow not found");
          return;
        }
        if (actionMatch[2] === "retry") store.workflows.retry(id);
        else {
          if (
            !["accept-changes", "keep-initial"].includes(String(body.action)) ||
            typeof body.note !== "string" ||
            !body.note.trim() ||
            body.note.length > 2000
          ) {
            response.writeHead(400).end("A valid action and review note are required");
            return;
          }
          store.workflows.resolve(id, {
            action: body.action as "accept-changes" | "keep-initial",
            actor: "local-admin",
            note: body.note.trim(),
          });
        }
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(leadWorkflow(store.workflows.get(id))));
      } catch {
        response.writeHead(409, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error: "action_failed",
            message: "Unable to apply action. Refresh to check the current state.",
          }),
        );
      }
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(403).end("Local dashboard only");
      return;
    }
    const workflowMatch = url.pathname.match(/^\/admin\/api\/workflows\/([a-zA-Z0-9-]+)$/);
    if (workflowMatch) {
      try {
        const workflow = leadWorkflow(store.workflows.get(workflowMatch[1]!));
        response
          .writeHead(workflow ? 200 : 404, { "Content-Type": "application/json" })
          .end(JSON.stringify(workflow));
      } catch {
        response.writeHead(503).end("Storage unavailable");
      }
      return;
    }
    if (url.pathname === "/admin/api/analytics") {
      try {
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(store.analytics(reps)));
      } catch {
        response
          .writeHead(503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "storage_unavailable" }));
      }
      return;
    }
    if (url.pathname === "/admin/api/pools") {
      try {
        const pools = await router.listPoolStates();
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ pools }));
      } catch {
        response
          .writeHead(503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "storage_unavailable" }));
      }
      return;
    }
    if (url.pathname === "/admin/api/submissions") {
      try {
        if (!store) throw new Error("Storage unavailable");
        const integer = (key: string, fallback: number) => {
          const value = Number(url.searchParams.get(key) ?? fallback);
          return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
        };
        const status = url.searchParams.get("status");
        const data = store.list({
          limit: integer("limit", 25),
          offset: integer("offset", 0),
          ...(status ? { status } : {}),
        });
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            ...data,
            csrfToken: adminToken,
            records: data.records.map((record) => ({
              ...record,
              workflow: record.decision
                ? leadWorkflow(store.workflows.get(record.decision.id))
                : null,
            })),
          }),
        );
      } catch {
        response.writeHead(503).end(JSON.stringify({ error: "storage_unavailable" }));
      }
      return;
    }
    const asset = dashboardAsset(url.pathname);
    if (!asset) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[extname(asset)] ?? "text/plain" });
    createReadStream(asset).pipe(response);
    return;
  }
  if (request.method === "POST" && request.url === "/route") {
    const submissionId = randomUUID();
    const started = performance.now();
    let created = false;
    try {
      const raw = Object.fromEntries(new URLSearchParams(await readBody(request)));
      const scenario = raw._researchScenario ?? "clean";
      delete raw._researchScenario;
      if (!["clean", "changes", "failure"].includes(scenario)) {
        throw new SubmissionValidationError([
          { field: "$researchScenario", message: "Unknown fixture scenario" },
        ]);
      }
      const idempotencyKey =
        request.headers["idempotency-key"] ?? raw._submissionId ?? submissionId;
      delete raw._submissionId;
      if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim() ||
        idempotencyKey.length > 200
      ) {
        throw new SubmissionValidationError([
          {
            field: "$idempotencyKey",
            message: "must be a nonempty string of at most 200 characters",
          },
        ]);
      }
      persist((store) => {
        store.create({
          id: submissionId,
          receivedAt: new Date().toISOString(),
          completedAt: null,
          durationMs: null,
          status: "pending",
          configVersion,
          input: redactSubmission(router.schema, raw),
          decision: null,
          error: null,
        });
        created = true;
      });
      const input = router.parse(raw, { coerce: true });
      const workflowRouter = createContactSalesRouter(
        store.workflows.assignmentStore(
          {
            mode: live ? "live-attio" : "fixture",
            researchMode: liveResearch ? "live" : "demo",
            scenario,
            companyName: input.companyName,
            companyDomain: input.workEmail.split("@")[1]!,
            requestedSeats: input.requestedSeats,
            requestType: input.requestType,
            business: {
              product: "Northstar",
              icp: "Knowledge-work teams with customer-facing meetings",
            },
            routingPolicy: {
              territories,
              reps,
              precedence:
                "Existing CRM owner first, then first matching territory by company country and employee count. Missing enrichment goes to a success page. Shared booking links are intentional.",
            },
          },
          workflowStart,
        ),
        enrichment,
        live?.ownership,
      );
      const decision = await workflowRouter.assign(input, { idempotencyKey });
      persist((store) =>
        store.complete(submissionId, decision, Math.round(performance.now() - started)),
      );

      console.log(
        JSON.stringify({
          event: "routing.decision.completed",
          decisionId: decision.id,
          submissionId,
          outcome: decision.outcome,
          ruleId: decision.ruleId,
          poolId: decision.poolId,
          personId: decision.personId,
          warnings: decision.warnings,
        }),
      );

      response.writeHead(303, { Location: decision.redirectUrl });
      response.end();
    } catch (error) {
      if (created)
        persist((store) =>
          store.fail(
            submissionId,
            {
              code:
                error instanceof SubmissionValidationError
                  ? "invalid_submission"
                  : "routing_failed",
              ...(error instanceof SubmissionValidationError
                ? { fields: error.issues.map((issue) => issue.field) }
                : {}),
            },
            Math.round(performance.now() - started),
          ),
        );
      response.writeHead(error instanceof SubmissionValidationError ? 400 : 503, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          error:
            error instanceof SubmissionValidationError ? "invalid_submission" : "routing_failed",
          issues: error instanceof SubmissionValidationError ? error.issues : undefined,
        }),
      );
    }
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(publicDirectory, relativePath);

  if (!filePath.startsWith(publicDirectory) || !existsSync(filePath)) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  if (relativePath === "index.html") {
    response.end(
      readFileSync(filePath, "utf8")
        .replace(
          "Sample research only. Notifications and CRM updates are mocked.",
          liveResearch
            ? `Live research enabled. Notifications are simulated; CRM updates are ${live ? "live" : "mocked"}. Demo research scenarios are ignored.`
            : live
              ? "Live Attio writes enabled. Research and notifications are simulated."
              : "Sample research only. Notifications and CRM updates are mocked.",
        )
        .replace(
          /(<form\b[^>]*>)/,
          `$1<input type="hidden" name="_submissionId" value="${randomUUID()}" />`,
        ),
    );
    return;
  }
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(
    `Contact-sales example: http://localhost:${typeof address === "object" && address ? address.port : port}`,
  );
});

const workerRun = worker.run({ signal: shutdown.signal, pollMs: 250 }).catch(() => {
  console.error(JSON.stringify({ event: "workflow.worker_stopped" }));
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    shutdown.abort();
    server.close(() => {
      void workerRun.finally(() => store.close());
    });
  });
}
