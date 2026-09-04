# Assign leads between two people

Shows round-robin assignment, idempotent retries, and who is next. Output: Alice, Alice again for the retry, then Bob; Alice is next.

From the repository root, after `npm install`:

```sh
npm run start --workspace=@open-routing/example-round-robin
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
