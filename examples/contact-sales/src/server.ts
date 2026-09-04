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
import { sqliteStore } from "@open-routing/store-sqlite";
import { pdl } from "@open-routing/pdl";
import { dashboardAsset } from "@open-routing/dashboard";
import { createContactSalesRouter, contactSalesSchema } from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";
import reps from "../fixtures/routing/reps.json" with { type: "json" };

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
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
const router = createContactSalesRouter(
  store,
  process.env.PDL_API_KEY ? pdl({ apiKey: process.env.PDL_API_KEY }) : undefined,
);
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

async function readForm(request: NodeJS.ReadableStream): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > 65536) throw new Error("Submission too large");
    chunks.push(Buffer.from(chunk));
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
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
    if (
      !["localhost", "127.0.0.1"].includes((request.headers.host ?? "").split(":")[0] ?? "") ||
      request.method !== "GET"
    ) {
      response.writeHead(403).end("Local dashboard only");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
    );
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
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
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
      const raw = await readForm(request);
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
      const decision = await router.assign(input, { idempotencyKey });
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
      readFileSync(filePath, "utf8").replace(
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
