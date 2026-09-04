# Open Routing

The server-side entry point: typed routing with persistent SQLite included.

```ts
import { createRouter } from "open-routing";

const router = createRouter({
  schema: { email: { type: "email", required: true } },
  people: {
    alice: { name: "Alice", bookingUrl: "https://cal.com/alice/demo" },
    bob: { name: "Bob", bookingUrl: "https://cal.com/bob/demo" },
  },
  pools: { sales: { members: ["alice", "bob"] } },
  rules: [{ id: "sales", assign: { pool: "sales" } }],
  fallback: { redirect: "/success" },
});

try {
  const result = await router.assign(
    { email: "buyer@example.com" },
    { idempotencyKey: "submission-123" },
  );
  console.log(result.redirectUrl);
} finally {
  await router.close();
}
```

The default database is `.data/routing.sqlite`, relative to the working directory
at construction. State survives restarts. Set `database` to another path or
`:memory:` for isolated tests. Use one persistent database per routing configuration:
pool IDs and idempotency keys share that database’s namespace. Persistent disk is
required; this default is not shared storage across multiple hosts.

For another backend, supply `store` instead of `database`. They are mutually
exclusive. `close()` is idempotent and closes only router-created storage. Call it
after in-flight assignments have finished; long-running servers close on shutdown,
not after each request. Caller-supplied stores remain caller-owned.

Pools default to round-robin; omit `pools` when assigning directly to people.
Omitting a rule’s `when` makes it unconditional; put catch-all rules last. Inline
schemas retain TypeScript inference. `defineSchema` remains available for schemas
declared separately. Fallback destinations and idempotency keys remain explicit.

Adapters remain separate imports: `pdl()` reads `PDL_API_KEY`, and `attio()` reads
`ATTIO_API_KEY`. Explicit `apiKey` options override the environment. Missing or
blank credentials fail during construction. Environment files are not loaded by
the SDK itself.

The lower-level `@open-routing/core` package remains storage-independent and
requires an explicit store. Workspaces are not yet published to npm.
