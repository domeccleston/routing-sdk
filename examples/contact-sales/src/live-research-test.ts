import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sqliteStore, createWorkflowWorker } from "@open-routing/store-sqlite";
import { createContactSalesRouter, contactSalesSchema } from "../router.config.js";
import territories from "../fixtures/routing/territories.json" with { type: "json" };
import reps from "../fixtures/routing/reps.json" with { type: "json" };
import { piResearch } from "./pi-research.js";
import { createLeadWorkflow } from "./lead-workflow.js";

const directory = fileURLToPath(new URL("../.data/research", import.meta.url));
const model = process.env.RESEARCH_MODEL ?? "openai/gpt-5.6-luna";
const research = piResearch({
  model,
  directory,
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  parallelApiKey: process.env.PARALLEL_API_KEY ?? "",
});
const store = sqliteStore(`${directory}.sqlite`, contactSalesSchema);
const definition = "research-live-test-v1";
const started = Date.now();
try {
  const router = createContactSalesRouter(
    store.workflows.assignmentStore(
      {
        companyName: "Linear",
        companyDomain: "linear.app",
        requestedSeats: 50,
        business: {
          product: "Northstar",
          icp: "Meeting collaboration software for knowledge-work teams with frequent customer meetings; ideal customers are software businesses with 50–500 employees.",
        },
        routingPolicy: {
          territories,
          reps,
          precedence:
            "Existing CRM owner first, then first matching territory by country and employee count. Missing enrichment leads to success page.",
        },
        testContext:
          "Synthetic inbound lead. Initial enrichment deliberately says US and 750 employees; treat these as unverified and review them against current research. No real booking or CRM update has happened.",
      },
      { definition, initialStage: "research" },
    ),
    {
      name: "synthetic-enrichment-for-review",
      async enrich() {
        return {
          status: "found",
          company: { domain: "linear.app", name: "Linear", country: "US", employeeCount: 750 },
        };
      },
    },
    {
      name: "synthetic-crm",
      async findOwner() {
        return { status: "company_not_found" };
      },
    },
  );
  const decision = await router.assign(
    {
      fullName: "Research Test",
      workEmail: "research-test@linear.app",
      companyName: "Linear",
      companySize: "501-1000",
      requestedSeats: 50,
      requestType: "sales",
    },
    { idempotencyKey: `research-test:${randomUUID()}` },
  );
  assert.equal(decision.poolId, "us-enterprise");
  console.log(
    JSON.stringify({
      event: "research.started",
      model,
      assignmentId: decision.id,
      calendar: decision.redirectUrl,
      directory,
    }),
  );
  const worker = createWorkflowWorker({
    store: store.workflows,
    definition: createLeadWorkflow(
      {
        research,
        async notify() {
          throw new Error("Research-only test must not send notifications");
        },
        async crm() {
          throw new Error("Research-only test must not write to CRM");
        },
      },
      definition,
    ),
    // Operational cancellation deadline, not a cap on the agent's tool loop.
    timeoutMs: 30 * 60_000,
    maxAttempts: 1,
  });
  await worker.runOnce();
  const workflow = store.workflows.get(decision.id)!;
  assert.equal(workflow.stage, "notify", "Research failed; inspect the private session artifacts");
  assert.equal(workflow.status, "pending");
  assert.ok(workflow.outputs.research);
  assert.equal(workflow.outputs.crm, undefined);
  console.log(
    JSON.stringify(
      {
        event: "research.completed",
        seconds: (Date.now() - started) / 1000,
        report: workflow.outputs.research,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
