import { createResearcher, pi, docker, parallel } from "@open-routing/research";

const researcher = createResearcher({
  agent: pi({
    provider: "openrouter",
    model: process.env.RESEARCH_MODEL ?? "openai/gpt-5.6-luna",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  }),
  sandbox: docker(),
  search: parallel({ apiKey: process.env.PARALLEL_API_KEY ?? "" }),
  instructions:
    "Assess ICP fit and whether public evidence changes the supplied routing decision. The assignment is synthetic, not a real booking.",
});
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const result = await researcher.run(
    {
      company: { name: "Linear", domain: "linear.app" },
      business: {
        description: "Meeting collaboration software",
        icp: "Software companies with 50–500 employees and frequent customer meetings",
      },
      assignment: { personId: "alice", poolId: "us-enterprise", country: "US", employeeCount: 750 },
      routingPolicy: {
        usEnterprise: { minimumEmployees: 500 },
        usCommercial: { maximumEmployees: 499 },
      },
    },
    { signal: controller.signal },
  );
  console.log(JSON.stringify(result, null, 2));
  console.log("Session artifacts:", researcher.session(result.session.id).directory);
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
