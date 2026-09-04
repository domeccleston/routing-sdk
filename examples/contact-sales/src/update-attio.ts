import type { AttioClient, AttioValue } from "@open-routing/attio";
import type { LeadHandlers } from "./lead-workflow.js";

/** Example policy. No arbitrary agent-proposed attribute names reach Attio. */
export function updateAttio(
  client: AttioClient,
  options: { memberIds?: Record<string, string> } = {},
): LeadHandlers["crm"] {
  return async ({ workflow, signal }) => {
    const context = workflow.context as { companyDomain: string; companyName: string };
    if (!context.companyDomain || !workflow.research || !workflow.resolution)
      throw new Error("Incomplete lead outcome");
    const values: Record<string, AttioValue> = {
      routing_research: [workflow.research.brief, ...workflow.research.sources].join("\n"),
    };
    if (workflow.resolution.action === "accept-changes") {
      for (const change of workflow.research.proposedChanges) {
        if (change.field !== "qualification" || change.value !== "strong-fit")
          throw new Error("Unsupported proposed change");
        values.routing_qualification = "strong-fit";
      }
    }
    // Preserve existing owners. Demo rep IDs are also the fake workspace member IDs.
    const owner = await client.findOwner({ domain: context.companyDomain });
    if (owner.status === "unavailable") throw new Error("Attio ownership unavailable");
    if (owner.status !== "owned" && workflow.assignment.personId) {
      const memberId = options.memberIds
        ? options.memberIds[workflow.assignment.personId]
        : workflow.assignment.personId;
      if (!memberId) throw new Error("Missing Attio member mapping");
      values.account_owner = [
        {
          referenced_actor_type: "workspace-member",
          referenced_actor_id: memberId,
        },
      ];
    }
    if (owner.status === "owned" || owner.status === "unowned") {
      return client.updateCompany({ recordId: owner.company.id, values, signal });
    }
    return client.upsertCompany({
      matchingAttribute: "domains",
      values: { ...values, domains: [context.companyDomain], name: context.companyName },
      signal,
    });
  };
}
