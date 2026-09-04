import { describe, expect, it, vi } from "vitest";
import { createWorkflowWorker, sqliteStore } from "@open-routing/store-sqlite";
import { createContactSalesRouter } from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";
import { createLeadWorkflow, leadWorkflowStart, type LeadHandlers } from "../src/lead-workflow.js";
import { createDemoAttio } from "../src/demo-attio.js";
import { updateAttio } from "../src/update-attio.js";

describe("example-owned workflow with Attio adapter", () => {
  it.each([true, false])(
    "validates live member mapping before assigning an unowned company (configured=%s)",
    async (configured) => {
      const store = sqliteStore(":memory:");
      try {
        const demo = createDemoAttio();
        const memberId = "2e0bc4b3-6504-463a-9329-f7880acb8962";
        const decision = await createContactSalesRouter(
          store.workflows.assignmentStore(
            { companyDomain: "unowned.example", companyName: "Unowned Systems" },
            leadWorkflowStart,
          ),
        ).assign(routingCases[1]!.input, { idempotencyKey: "live-member" });
        const worker = createWorkflowWorker({
          store: store.workflows,
          maxAttempts: 1,
          definition: createLeadWorkflow({
            research: async () => ({ brief: "Report", sources: [], proposedChanges: [] }),
            notify: async () => {},
            crm: updateAttio(demo.client, {
              memberIds: configured ? { [decision.personId!]: memberId } : {},
            }),
          }),
        });
        await worker.runOnce();
        await worker.runOnce();
        await worker.runOnce();
        expect(store.workflows.get(decision.id)?.status).toBe(configured ? "completed" : "failed");
        expect(demo.records.get("company_unowned")?.values.account_owner).toEqual(
          configured
            ? [{ referenced_actor_type: "workspace-member", referenced_actor_id: memberId }]
            : [],
        );
      } finally {
        store.close();
      }
    },
  );
  it.each(["accept-changes", "keep-initial"])(
    "applies %s without rewriting the initial assignment",
    async (action) => {
      const store = sqliteStore(":memory:");
      try {
        const demo = createDemoAttio();
        const valuesBefore = structuredClone(demo.records.get("company_acme")!.values);
        const decision = await createContactSalesRouter(
          store.workflows.assignmentStore(
            { companyDomain: "acme.example", companyName: "Acme" },
            leadWorkflowStart,
          ),
        ).assign(routingCases[0]!.input, { idempotencyKey: action });
        const handlers: LeadHandlers = {
          research: async () => ({
            brief: "Sample report",
            sources: [],
            proposedChanges: [{ field: "qualification", value: "strong-fit", reason: "ICP" }],
          }),
          notify: vi.fn(async () => {}),
          crm: updateAttio(demo.client),
        };
        const worker = createWorkflowWorker({
          store: store.workflows,
          definition: createLeadWorkflow(handlers),
        });
        await worker.runOnce();
        await worker.runOnce();
        expect(demo.records.get("company_acme")!.values).toEqual(valuesBefore);
        store.workflows.resolve(decision.id, { action, actor: "test", note: "Reviewed" });
        await worker.runOnce();
        const values = demo.records.get("company_acme")!.values;
        expect(values.routing_research).toEqual([{ value: "Sample report" }]);
        expect(values.routing_qualification).toEqual(
          action === "accept-changes" ? [{ value: "strong-fit" }] : undefined,
        );
        expect(values.account_owner).toEqual(valuesBefore.account_owner);
        expect(store.workflows.get(decision.id)?.outputs.crm).toEqual({
          recordId: "company_acme",
          url: null,
        });
        expect(store.getAssignment(action)).toEqual(decision);
      } finally {
        store.close();
      }
    },
  );
  it("creates missing companies and repeats scalar writes without duplicate records", async () => {
    const demo = createDemoAttio();
    const values = { domains: ["new.example"], name: "New Co", routing_research: "Report" };
    const first = await demo.client.upsertCompany({ matchingAttribute: "domains", values });
    const second = await demo.client.upsertCompany({ matchingAttribute: "domains", values });
    expect(first).toEqual(second);
    expect(demo.records.size).toBe(4);
  });
  it("rejects arbitrary proposed attribute names before any CRM write", async () => {
    const store = sqliteStore(":memory:");
    try {
      const demo = createDemoAttio();
      const original = structuredClone([...demo.records]);
      const decision = await createContactSalesRouter(
        store.workflows.assignmentStore(
          { companyDomain: "acme.example", companyName: "Acme" },
          leadWorkflowStart,
        ),
      ).assign(routingCases[0]!.input, { idempotencyKey: "unsafe" });
      const worker = createWorkflowWorker({
        store: store.workflows,
        maxAttempts: 1,
        definition: createLeadWorkflow({
          research: async () => ({
            brief: "Report",
            sources: [],
            proposedChanges: [{ field: "account_owner", value: "attacker", reason: "Untrusted" }],
          }),
          notify: async () => {},
          crm: updateAttio(demo.client),
        }),
      });
      await worker.runOnce();
      await worker.runOnce();
      store.workflows.resolve(decision.id, {
        action: "accept-changes",
        actor: "test",
        note: "Reviewed",
      });
      await worker.runOnce();
      expect(store.workflows.get(decision.id)?.status).toBe("failed");
      expect([...demo.records]).toEqual(original);
    } finally {
      store.close();
    }
  });
});
