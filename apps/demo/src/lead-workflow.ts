import type { ResearchResult } from "@open-routing/research";
import type {
  JsonValue,
  WorkflowDefinition,
  WorkflowHandlerContext,
  WorkflowRecord,
} from "@open-routing/store-sqlite";

type ResearchReport = {
  brief: string;
  sources: string[];
  proposedChanges: { field: string; value: JsonValue; reason: string }[];
  findings?: ResearchResult["findings"];
  review?: ResearchResult["review"];
  session?: ResearchResult["session"];
};
type Resolution = { action: "keep-initial" | "accept-changes"; actor: string; note: string };
export type LeadWorkflow = Omit<WorkflowRecord, "resolution"> & {
  research: ResearchReport | null;
  resolution: Resolution | null;
};
type LeadContext = Omit<WorkflowHandlerContext, "workflow"> & { workflow: LeadWorkflow };
export interface LeadHandlers {
  research(context: LeadContext): Promise<ResearchReport>;
  notify(context: LeadContext): Promise<void>;
  crm(context: LeadContext): Promise<JsonValue | void>;
}

export const leadWorkflowStart = { definition: "contact-sales-v1", initialStage: "research" };

function needsReview(report: ResearchReport | null) {
  return (
    !!report &&
    (report.proposedChanges.length > 0 ||
      (report.review !== undefined && report.review.status !== "consistent"))
  );
}

/** Presentation and policy belong to this example, not the durable store. */
export function leadWorkflow(record: WorkflowRecord | null): LeadWorkflow | null {
  if (!record) return null;
  const research = (record.outputs.research ?? null) as ResearchReport | null;
  const resolution = (record.resolution ??
    (record.stage === "crm" && !needsReview(research)
      ? { action: "keep-initial", actor: "system", note: "No changes proposed" }
      : null)) as Resolution | null;
  return { ...record, research, resolution };
}

export function createLeadWorkflow(
  handlers: LeadHandlers,
  id = leadWorkflowStart.definition,
): WorkflowDefinition {
  const context = (value: WorkflowHandlerContext): LeadContext => ({
    ...value,
    workflow: leadWorkflow(value.workflow)!,
  });
  return {
    id,
    steps: {
      async research(value) {
        const report = await handlers.research(context(value));
        if (
          typeof report?.brief !== "string" ||
          !Array.isArray(report.sources) ||
          !report.sources.every((source) => typeof source === "string") ||
          (report.review !== undefined &&
            (!report.review ||
              !["consistent", "needs-review", "inconclusive"].includes(report.review.status) ||
              typeof report.review.reason !== "string")) ||
          !Array.isArray(report.proposedChanges) ||
          !report.proposedChanges.every(
            (change) =>
              typeof change.field === "string" &&
              typeof change.reason === "string" &&
              "value" in change,
          )
        )
          throw new Error("Invalid research report");
        return { output: report, transition: { type: "next", stage: "notify" } };
      },
      async notify(value) {
        const lead = context(value);
        await handlers.notify(lead);
        return {
          output: null,
          transition: {
            type: needsReview(lead.workflow.research) ? "wait" : "next",
            stage: "crm",
          },
        };
      },
      async crm(value) {
        const lead = context(value);
        if (
          !lead.workflow.resolution ||
          !["keep-initial", "accept-changes"].includes(lead.workflow.resolution.action)
        )
          throw new Error("A resolved outcome is required");
        const output = await handlers.crm(lead);
        return { output: output ?? null, transition: { type: "complete" } };
      },
    },
  };
}
