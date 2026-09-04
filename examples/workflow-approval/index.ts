import { createRouter } from "open-routing";
import { createWorkflowWorker, sqliteStore } from "@open-routing/store-sqlite";

const store = sqliteStore(":memory:");
try {
  const router = createRouter({
    schema: { email: { type: "email", required: true } },
    people: { alice: { name: "Alice", bookingUrl: "https://cal.com/dom-eccleston/30min" } },
    rules: [{ id: "sales", assign: { person: "alice" } }],
    fallback: { redirect: "/success" },
    // Assignment and workflow creation commit atomically.
    store: store.workflows.assignmentStore(
      { company: "Example Co" },
      { definition: "approval", initialStage: "review" },
    ),
  });
  const assignment = await router.assign(
    { email: "buyer@example.com" },
    { idempotencyKey: "lead-1" },
  );
  const worker = createWorkflowWorker({
    store: store.workflows,
    definition: {
      id: "approval",
      steps: {
        async review() {
          return {
            output: { note: "Demo review required" },
            transition: { type: "wait", stage: "complete" },
          };
        },
        async complete({ workflow }) {
          return { output: { reviewed: workflow.resolution }, transition: { type: "complete" } };
        },
      },
    },
  });
  await worker.runOnce();
  const held = store.workflows.get(assignment.id)!.status;
  store.workflows.resolve(assignment.id, { reviewer: "demo-admin", note: "Keep the assignment" });
  await worker.runOnce();
  console.log(
    JSON.stringify({
      calendar: assignment.redirectUrl,
      beforeReview: held,
      afterReview: store.workflows.get(assignment.id)!.status,
    }),
  );
} finally {
  store.close();
}
