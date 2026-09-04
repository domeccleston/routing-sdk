# Pi research session

This is an example-owned research implementation, not an SDK agent framework.
`piResearch(...)` implements the existing `LeadHandlers.research` callback by
starting a real Pi session in a Docker sandbox. Pi controls the reasoning and
tool loop. There is no host-defined search sequence or tool-call count limit.

The container has normal shell, filesystem and network access, plus Node,
Python, curl, git and a convenience Parallel search CLI. It can install tools
and write scripts. Only its per-run working directory is mounted, not the repo,
host home directory or Docker socket. Only research-provider credentials are
passed in; the agent does not receive Attio credentials.

## Run a live test

Put `OPENROUTER_API_KEY`, `PARALLEL_API_KEY`, and optionally `RESEARCH_MODEL` in
the ignored root `.env.research.local`. The default model is
`openai/gpt-5.6-luna`.

```sh
npm run research:build
npm run test:research:live
```

Docker must be running. The image pins Pi to `@earendil-works/pi-coding-agent@0.85.0`.
No Pi or model SDK dependency is added to the routing packages.

The test routes a synthetic Linear lead with deliberately unverified enrichment,
returns the calendar link, then runs real web research and persists the report
through the SQLite workflow. It stops before notification/CRM steps. This is a
live integration smoke test, not an accuracy benchmark or a real booking.

Artifacts are private local files under `examples/contact-sales/.data/research/`:
each run retains `context.json`, Pi's `session.jsonl`, `report.json`, any agent
notes, and `agent.log`. The SQLite workflow lives in `.data/research.sqlite`.
These files are ignored by git. Treat transcripts as sensitive; do not publish
them. The agent has its API credentials in its environment. Log redaction is
defense in depth, not a guarantee against an agent disclosing secrets.

## Use the callback

```ts
const research = piResearch({
  model: "openai/gpt-5.6-luna",
  openRouterApiKey: process.env.OPENROUTER_API_KEY!,
  parallelApiKey: process.env.PARALLEL_API_KEY!,
  directory: "./.data/research",
});

createLeadWorkflow({ research, notify, crm });
```

The model is a Pi model identifier; the search helper and prompt live beside the
Dockerfile and can be replaced independently. Another harness can implement the
same research callback without changing the workflow or routing SDK.

The host validates only the output contract. Sources are not automatically
fact-checked; proposals remain advisory. Existing CRM policy rejects unsupported
fields rather than blindly applying model output. A sourced report does not
prove correct research. Review evidence before enabling live follow-up writes.

The existing worker's cancellation signal stops the container. The smoke test
sets a 30-minute operational deadline; it does not impose a turn/search budget.
Retries start a new session and may incur additional provider charges. The local
server is still using demo research until its handler is explicitly replaced.

References: [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent),
[Parallel Search API](https://docs.parallel.ai/search/search-quickstart).
