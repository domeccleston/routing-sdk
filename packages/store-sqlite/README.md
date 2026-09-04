# @open-routing/store-sqlite

Local SQLite implementation of the core `DecisionStore` contract.

```ts
const store = sqliteDecisionStore("./.data/routing.sqlite", schema);
```

See [the record model](../../docs/decision-records.md) for lifecycle, privacy,
schema versioning, and local-only limitations.
