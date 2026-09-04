import { createResearcher, pi, docker, parallel } from "@open-routing/research";
import type { LeadHandlers } from "./lead-workflow.js";

/** Business context and workflow mapping belong to the application. */
export function salesResearch(options: {
  directory: string;
  model: string;
  openRouterApiKey: string;
  parallelApiKey: string;
  instructions?: string;
}): LeadHandlers["research"] {
  const researcher = createResearcher({
    agent: pi({ provider: "openrouter", model: options.model, apiKey: options.openRouterApiKey }),
    sandbox: docker(),
    search: parallel({ apiKey: options.parallelApiKey }),
    directory: options.directory,
    instructions: [
      "Act as an SDR for Northstar. Assess company fit, useful sales context and routing. Shared rep booking links are intentional in this demo. Do not infer customer-meeting needs from the company's product alone.",
      options.instructions,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return async ({ workflow, signal }) => {
    const context = workflow.context as {
      companyName: string;
      companyDomain: string;
      business?: { product?: string; icp: string };
      routingPolicy?: unknown;
    };
    const result = await researcher.run(
      {
        company: { name: context.companyName, domain: context.companyDomain },
        business: {
          description: context.business?.product ?? "Northstar meeting collaboration software",
          icp:
            context.business?.icp ??
            "Software companies with 50–500 employees and frequent customer meetings",
        },
        assignment: workflow.assignment,
        routingPolicy: context.routingPolicy,
        context: workflow.context,
      },
      { signal },
    );
    return {
      ...result,
      sources: [...new Set(result.findings.flatMap((finding) => finding.sources))],
      proposedChanges: [],
    };
  };
}
