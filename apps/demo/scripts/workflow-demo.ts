import { sqliteStore, createWorkflowWorker } from "@open-routing/store-sqlite";
import { createContactSalesRouter, contactSalesSchema } from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";
import { createLeadWorkflow, leadWorkflowStart } from "../src/lead-workflow.js";
import { createDemoAttio } from "../fixtures/attio-client.js";
import { updateAttio } from "../src/update-attio.js";

// Deterministic and offline: no real research, notification or CRM writes.
const store = sqliteStore(":memory:", contactSalesSchema);
try {
  const input = routingCases[0]!.input;
  const router = createContactSalesRouter(
    store.workflows.assignmentStore(
      {
        companyDomain: input.workEmail.split("@")[1]!,
        companyName: input.companyName,
        icp: "Knowledge-work teams with frequent customer meetings",
      },
      leadWorkflowStart,
    ),
  );
  const decision = await router.assign(input, { idempotencyKey: "demo-lead" });
  console.log("Calendar available immediately:", decision.redirectUrl);

  const worker = createWorkflowWorker({
    store: store.workflows,
    definition: createLeadWorkflow({
      async research() {
        return {
          brief: "Demo scenario: verify the account owner before CRM updates.",
          sources: [],
          proposedChanges: [
            { field: "qualification", value: "strong-fit", reason: "Demo ICP match" },
          ],
        };
      },
      async notify({ workflow, idempotencyKey }) {
        console.log("Mock notification:", idempotencyKey, workflow.research?.brief);
      },
      crm: updateAttio(createDemoAttio().client),
    }),
  });
  await worker.runOnce(); // Research, then persist report and queue notification.
  await worker.runOnce(); // Notify, then wait durably for approval.
  console.log("Status:", store.workflows.get(decision.id)?.status);
  store.workflows.resolve(decision.id, {
    action: "accept-changes",
    actor: "demo-admin",
    note: "Demo scenario reviewed",
  });
  await worker.runOnce(); // Mock CRM update only after approval.
  console.log("Status:", store.workflows.get(decision.id)?.status);
  console.log("Demo Attio receipt:", store.workflows.get(decision.id)?.outputs.crm);
} finally {
  store.close();
}
