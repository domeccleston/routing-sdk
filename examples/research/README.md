# Research a company after assignment

Runs a Pi agent in Docker with Parallel search and a synthetic assignment. Prints the structured report and session artifact directory. It does not book meetings or update a CRM.

Requires Docker, `OPENROUTER_API_KEY`, and `PARALLEL_API_KEY`. Root `.env.research.local` is loaded automatically. Optionally set `RESEARCH_MODEL`; the default is `openai/gpt-5.6-luna`. Build the sandbox from the repository root with `pnpm run research:build` first.

This is a live, paid example, excluded from offline smoke tests. Session artifacts are written to this example’s ignored `.data/research` directory. Ctrl-C cancels the session.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @open-routing/example-research run start
```

Read [index.ts](index.ts) for the complete scenario.
