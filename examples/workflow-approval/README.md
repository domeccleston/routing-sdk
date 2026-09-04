# Pause a workflow for review

Commits the assignment and workflow together, returns a calendar URL immediately, then pauses background work for approval. A simulated reviewer resumes it. Output progresses from `awaiting_approval` to `completed`. No external services are called.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @open-routing/example-workflow-approval run start
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
