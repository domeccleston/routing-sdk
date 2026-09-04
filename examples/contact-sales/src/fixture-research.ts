import { setTimeout as delay } from "node:timers/promises";
import type { LeadHandlers } from "./lead-workflow.js";

/** Offline demo only. No LLM, messaging service or CRM write is invoked. */
export const fixtureResearchHandlers: Pick<LeadHandlers, "research" | "notify"> = {
  async research({ workflow, signal }) {
    await delay(300, undefined, { signal });
    const context = workflow.context as { scenario: string; companyName: string; mode?: string };
    // Manual retry preserves lastError, so the failure fixture recovers on retry.
    if (context.scenario === "failure" && workflow.lastError === null) {
      throw new Error("Simulated research failure");
    }
    return {
      brief: `Demo scenario for ${context.companyName}. This is sample output, not verified company research. ${context.scenario === "changes" ? `Review the proposed qualification before the ${context.mode === "live-attio" ? "Attio" : "mock CRM"} update.` : "No changes to the initial assignment are proposed."}`,
      sources: [],
      proposedChanges:
        context.scenario === "changes"
          ? [
              {
                field: "qualification",
                value: "strong-fit",
                reason: "Simulated ICP match; verify before accepting.",
              },
            ]
          : [],
    };
  },
  async notify({ workflow, idempotencyKey }) {
    console.log(
      JSON.stringify({
        event: "workflow.mock_notification",
        workflowId: workflow.id,
        idempotencyKey,
      }),
    );
  },
};
