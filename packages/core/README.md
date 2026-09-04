# `@open-routing/core`

The provider-neutral routing SDK. It contains:

- strongly typed form schemas and runtime validation;
- normalized company-enrichment and CRM-ownership contracts;
- ordered routing rules, ownership precedence, and round-robin pools;
- serializable, explainable lead assignments.

It contains no HTTP server, UI, vendor credentials, or example data.

```ts
import { createRouter, defineSchema } from "@open-routing/core";
import { sqliteStore } from "@open-routing/store-sqlite";

const schema = defineSchema({
  email: { type: "email", required: true, privacy: "mask" },
  country: { type: "string", required: true },
});
const store = sqliteStore("./routing.sqlite", schema);
const router = createRouter({
  schema,
  people: {
    dom: { name: "Dom", bookingUrl: "https://cal.com/dom-eccleston/30min" },
    alex: { name: "Alex", bookingUrl: "https://cal.com/alex/30min" },
  },
  pools: {
    sales: { members: ["dom", "alex"], strategy: "round-robin" },
  },
  rules: [
    { id: "us-sales", when: { field: "input.country", equals: "US" }, assign: { pool: "sales" } },
  ],
  fallback: { redirect: "/success.html" },
  store,
});

const result = await router.assign(
  { email: "buyer@example.com", country: "US" },
  { idempotencyKey: "submission-123" },
);
// Redirect with 303 to result.redirectUrl.
store.close();
```

`router.parse(raw, { coerce: true })` validates HTML form strings before `assign()`.
`assign()` also validates typed input at runtime. No provider or email field is
required for a simple pool. Configuration can be a JS object or parsed JSON;
pass runtime provider/store implementations separately.

## Rules and territories

Rules run in declaration order. Conditions support `equals`, `notEquals`, `in`,
`gte`, `lte`, and nested `all`/`any`; `{ all: [] }` matches everything. Numeric
comparisons do not coerce strings. Missing fields do not satisfy `notEquals`.
Fields use paths into `input`, enriched `company` (e.g. `company.country`), and
`crm.owner`. A territory is a rule matching geography/segment and targeting a pool.
Pools can overlap with independent rotations, or several rules can share one pool.

Targets are `{ assign: { pool: "sales" } }`, `{ assign: { person: "dom" } }`,
`{ assign: { owner: true } }`, or `{ redirect: "/success", reason: "not_sales" }`.
The ownership provider's `owner.id` must match a configured person key.
An unknown/inactive CRM owner falls through to subsequent rules with a warning.
Otherwise the first matching rule wins: an inactive direct target or pool with no
active members returns `unassigned` and the fallback URL, without trying other rules.

People default to active; set `active: false` to exclude them. URLs are HTTPS,
with same-origin absolute paths also allowed for redirect/fallback destinations.
Cal.com has no special SDK behavior: it is simply a person's booking URL.

## Assignment semantics

- Successful pool assignments advance that pool once, in member order.
- Direct assignments and unassigned outcomes do not advance a pool.
- Assignment results and cursor changes commit atomically; storage failure throws.
- Retries with the same key return the original result, even after configuration
  or input changes. Use a new key for a new opportunity, not an email address.
- Keys and pool IDs are scoped to the store. Use separate databases for independent
  routers, or namespace keys and pool IDs when deliberately sharing a store.
- Providers may run more than once for concurrent attempts, but assignment commits once.
- Booking, cancellation, and abandonment do not affect lead allocation.
- No weights, calendar availability, reassignment, or CRM writes are implemented.

Results include `id`, `outcome` (`assigned`/`unassigned`), `redirectUrl`, optional
`ruleId`/`poolId`/`personId`, an unassigned `reason`, provider facts, condition traces,
and warnings. Raw form inputs are not returned or stored in assignment results;
private form operands in traces are redacted. Submission logging is a separate
`DecisionStore` concern; the SQLite adapter implements both contracts.

## Inspecting pools

```ts
const pool = await router.getPoolState("sales");
// pool.lastAssignedPersonId, pool.nextPersonId, pool.eligiblePersonIds, pool.members
const pools = await router.listPoolStates();
```

These read-only methods combine current configured membership with the store's
`getPoolCursor(poolId)`. They never run providers or consume a turn. A new pool has
no last assignment and starts at its first active member. A pool without active
members has `nextPersonId: null`. Unknown pool IDs throw. Each pool is a snapshot,
not a reservation or a transactionally consistent snapshot across all pools;
concurrent assignments can change who is next. Optional pool `name` labels the UI.
