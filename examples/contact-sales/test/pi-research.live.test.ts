import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWorkflowWorker, sqliteStore } from "@open-routing/store-sqlite";
import { createContactSalesRouter, contactSalesSchema } from "../router.config.js";
import territories from "../fixtures/routing/territories.json" with { type: "json" };
import reps from "../fixtures/routing/reps.json" with { type: "json" };
import { createLeadWorkflow } from "../src/lead-workflow.js";
import { piResearch } from "../src/pi-research.js";

// Live smoke coverage; research quality is reviewed from the saved reports and
// sources, not graded by brittle keyword matches or by telling the agent answers.
const cases = [
  { id: "size-review", name: "Linear", domain: "linear.app", employees: 750, owned: false },
  { id: "owner-parent", name: "GitHub", domain: "github.com", employees: 3000, owned: true },
  {
    id: "unknown-company",
    name: "Kestrel Violet Systems 8f23",
    domain: "kestrel-violet-8f23.example.com",
    employees: null,
    owned: false,
  },
];

describe.skipIf(process.env.RUN_RESEARCH_INTEGRATION_TESTS !== "1")(
  "live Pi research review",
  () => {
    it.each(cases)(
      "$id",
      async (scenario) => {
        const store = sqliteStore(":memory:", contactSalesSchema);
        const definition = `review-${scenario.id}`;
        const directory = fileURLToPath(
          new URL(`../.data/research-review/${scenario.id}`, import.meta.url),
        );
        let crmCalls = 0;
        let researchCalls = 0;
        try {
          const router = createContactSalesRouter(
            store.workflows.assignmentStore(
              {
                companyName: scenario.name,
                companyDomain: scenario.domain,
                requestedSeats: 50,
                business: {
                  product: "Northstar",
                  icp: "Meeting collaboration software for knowledge-work teams with frequent customer meetings; ideal customers are software businesses with 50–500 employees.",
                },
                routingPolicy: {
                  territories,
                  reps,
                  precedence:
                    "Existing CRM owner takes precedence over territory; otherwise use first matching territory by country and employee count. Missing enrichment goes to a success page. No policy exists to substitute a parent's size for a subsidiary's.",
                },
                environment:
                  "Test contact submission, not a real person or booking. Rep booking links are intentionally identical for this demo; do not propose changing them. Company enrichment may be stale. CRM ownership in the assignment is authoritative for this test. Assess the company independently using public evidence.",
              },
              { definition, initialStage: "research" },
            ),
            {
              name: "test-enrichment",
              async enrich() {
                return scenario.employees === null
                  ? { status: "not_found" }
                  : {
                      status: "found",
                      company: {
                        name: scenario.name,
                        domain: scenario.domain,
                        employeeCount: scenario.employees,
                        country: "US",
                      },
                    };
              },
            },
            {
              name: "test-ownership",
              async findOwner() {
                return scenario.owned
                  ? { status: "owned", company: { id: "test-company" }, owner: { id: "rep_luca" } }
                  : { status: "company_not_found" };
              },
            },
          );
          const input = {
            fullName: "Research Test",
            workEmail: `test@${scenario.domain}`,
            companyName: scenario.name,
            companySize: "501-1000" as const,
            requestedSeats: 50,
            requestType: "sales" as const,
          };
          const decision = await router.assign(input, { idempotencyKey: scenario.id });
          expect(decision.personId).toBe(
            scenario.owned ? "rep_luca" : scenario.employees ? "rep_amelia" : undefined,
          );
          const research = piResearch({
            directory,
            model: "openai/gpt-5.6-luna",
            openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
            parallelApiKey: process.env.PARALLEL_API_KEY ?? "",
          });
          const worker = createWorkflowWorker({
            store: store.workflows,
            definition: createLeadWorkflow(
              {
                async research(context) {
                  researchCalls++;
                  return research(context);
                },
                async notify() {},
                async crm() {
                  crmCalls++;
                  throw new Error("No CRM writes permitted in this test");
                },
              },
              definition,
            ),
            timeoutMs: 30 * 60_000,
            maxAttempts: 1,
          });
          const started = Date.now();
          await worker.runOnce();
          const record = store.workflows.get(decision.id)!;
          console.log(
            JSON.stringify({
              case: scenario.id,
              seconds: (Date.now() - started) / 1000,
              status: record.status,
              stage: record.stage,
              directory,
            }),
          );
          expect(record.stage, `Inspect ${directory} for agent output`).toBe("notify");
          expect(record.outputs.research).toBeTruthy();
          await worker.runOnce(); // Stub notification, then approval hold or CRM queue.
          const after = store.workflows.get(decision.id)!;
          expect(["awaiting_approval", "pending"]).toContain(after.status);
          expect(crmCalls).toBe(0);
          expect(researchCalls).toBe(1);
          expect(await router.assign(input, { idempotencyKey: scenario.id })).toEqual(decision);
          expect(store.workflows.get(decision.id)).toEqual(after);
        } finally {
          store.close();
        }
      },
      31 * 60_000,
    );
  },
);
