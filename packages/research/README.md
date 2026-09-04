# @open-routing/research

Company research and routing review using a real agent session. No dependency
on the routing core, SQLite workflow runtime, CRM adapters, or the example.

```ts
import { createResearcher, pi, docker, parallel } from "@open-routing/research";

const researcher = createResearcher({
  agent: pi({
    provider: "openrouter",
    model: "openai/gpt-5.6-luna",
    apiKey: process.env.OPENROUTER_API_KEY!,
  }),
  sandbox: docker(),
  search: parallel({ apiKey: process.env.PARALLEL_API_KEY! }),
  instructions: "Research our ICP fit and review the assignment against our policy.",
  directory: "./.data/research",
});

const research = await researcher.run(
  {
    company: { name: "Linear", domain: "linear.app" },
    business: {
      description: "Meeting collaboration software",
      icp: "Software businesses with 50–500 employees",
    },
    assignment,
    routingPolicy,
  },
  { signal },
);

console.log(research.brief, research.review);
const artifacts = researcher.session(research.session.id);
```

`ResearchResult` contains `brief`, `findings: { description, sources }[]`,
`review: { status, reason }`, and a host-assigned `session: { id }`. Review status
is `consistent`, `needs-review`, or `inconclusive`. No executable CRM mutations
are generated. Applications own approval policy, messages, and concrete writes.
Uncertainty that cannot materially affect routing belongs in findings, not an
automatic review hold. A syntactically valid report does not establish accuracy.

## Runtime

Build the included image from the monorepo root with `pnpm run research:build`.
It installs Pi 0.85.0, Node, Python, curl and git. Docker must be running.
Use `docker({ image })` for a custom image. Pi owns the complete agent loop:
there is no SDK turn count, prescribed search sequence or tool allowlist.
The container has normal shell, filesystem and network access. It can install
tools and write scripts. Only its fresh workspace is mounted; no host home,
repository, Docker socket or unrelated application credentials are mounted.

Pass `signal` to cancel the run and remove the container. There is no default
SDK execution deadline; the application's workflow runtime can supply one.
Each `run()` creates a new session (including retries). The caller owns retry,
idempotency, provider costs, artifact retention and operational timeouts.

Failures throw `ResearchError` with `code` (`cancelled`, `execution_failed`, or
`invalid_output`) and `sessionId`, without provider bodies or credentials.
Use `researcher.session(id)` to locate context, logs, transcript and result.
Pre-launch failures may not have artifacts. Missing Docker/image/provider/model
errors appear as execution failures; inspect the private logs for agent errors.

## Replaceable adapters

`ResearchAgent` supplies a command and environment for the chosen sandbox.
`ResearchSandbox` runs that command in a session directory and honors cancellation.
`ResearchSearch` supplies instructions, helper files and its own credentials;
search is optional. Pi, Docker and Parallel are working defaults, not mandatory
dependencies. Custom agents must write the documented report to `/work/report.json`.
Pi supports OpenRouter, OpenAI and Anthropic key environment names directly;
use `apiKeyEnv` for another supported Pi provider.

## Privacy

Persisted inputs, reports, raw agent logs and transcripts are sensitive. Keep
the configured directory out of version control and protect it appropriately.
Only pass context you intend to share with the model/search providers. Credentials
are available to the sandbox process but not written into the prompt or SDK result.
An agent with shell access can read its environment; prompt instructions are not
a guarantee against disclosure. Logs are private raw artifacts, not safe public
telemetry. This local Docker adapter is not a hardened multi-tenant service.

Source URLs are validated for safe link rendering, not independently fact-checked.
The host refuses output symlinks and non-regular report files. Session artifacts
other than the parsed result remain untrusted. Do not execute generated files on
the host or blindly apply findings to external systems.
