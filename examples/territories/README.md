# Round-robin within territories

Routes US and UK submissions to separate pools. The sequence US, GB, US, AU assigns Alice, Charlie, Bob, then redirects the unsupported territory to `/success`.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @open-routing/example-territories run start
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
