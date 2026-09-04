# Round-robin within territories

Routes US and UK submissions to separate pools. The sequence US, GB, US, AU assigns Alice, Charlie, Bob, then redirects the unsupported territory to `/success`.

From the repository root, after `npm install`:

```sh
npm run start --workspace=@open-routing/example-territories
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
