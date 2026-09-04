# Route using enriched company size

The simulated company has 750 employees and goes to the enterprise rep. Missing size falls back to `/success`.

For real enrichment, set `PDL_LIVE=1`, `PDL_API_KEY`, and `COMPANY_DOMAIN`. Root `.env.local` is loaded automatically. This calls PDL and may consume credits.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @open-routing/example-enrichment run start
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
