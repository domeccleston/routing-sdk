# @open-routing/store-sqlite

Local SQLite implementation of the core `AssignmentStore` and `DecisionStore` contracts.

```ts
const store = sqliteStore("./.data/routing.sqlite", schema);
```

See [the record model](../../docs/decision-records.md) for lifecycle, privacy,
schema versioning, and local-only limitations.

Assignment commits use an immediate transaction and a second idempotency check
under the write lock. The pool cursor and immutable result are saved together.
Independent processes sharing the file cannot consume the same turn; failures roll
back both writes. A 5-second busy timeout allows competing writers to finish.

Each cursor stores the last assigned person ID. Selection starts after that person
in the current eligible member list; if they were removed or made inactive, it
restarts from the first eligible member. New members join in their configured order.
Run compatible pool configurations against a shared database during rollouts.

Schema v2 adds assignments and pool rotations without modifying existing v1
submission records. `sqliteDecisionStore` remains an alias for logging-only callers.
Pass a schema when using submission logging, so privacy filtering retains declared
non-private fields. Call `close()` when the store is no longer needed.
