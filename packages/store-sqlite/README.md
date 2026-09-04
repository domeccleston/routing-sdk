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
submission records. Schema v3 adds opt-in lead workflows. `sqliteDecisionStore`
remains an alias for logging-only callers.
Pass a schema when using submission logging, so privacy filtering retains declared
non-private fields. Call `close()` when the store is no longer needed.

`store.analytics(people?)` returns a read-only, all-time `AnalyticsSummary` in a
SQLite read transaction. It covers all records, not the paginated submission list.
Committed assignments are authoritative; legacy completed submission snapshots
supplement them. Assignment IDs deduplicate retries and audit copies. Pending/failed
attempts contribute only to submission counts. Assignment metrics still include
committed results whose best-effort audit logging failed.

Size/industry/country breakdowns count processed leads, not unique companies.
Missing enrichment is an explicit Unknown bucket. The company table groups known
enriched domains and shows one saved profile per domain; unknown domains are excluded.
Rep metrics distinguish pool and direct assignments; legacy records without a pool
ID do not have an inferred method. Booking counts are null (not tracked), never zero.
No booking webhooks, conversion rates, date filters, or new enrichment calls are involved.

## Durable workflows

The application owns the step sequence and business policy. SQLite owns claims,
leases, results, retries and durable approval waits. No research or CRM concepts
are built into the runtime.

```ts
const definition = {
  id: "my-workflow-v1",
  steps: {
    async collect({ workflow, signal }) {
      const result = await collectInformation(workflow.context, signal);
      return {
        output: result,
        transition: { type: "next", stage: "publish" },
      };
    },
    async publish({ workflow, signal, idempotencyKey }) {
      const receipt = await publish(workflow.outputs.collect, { signal, idempotencyKey });
      return { output: receipt, transition: { type: "complete" } };
    },
  },
};

const router = createRouter({
  ...routingConfig,
  store: store.workflows.assignmentStore(
    { companyDomain: "example.com" },
    { definition: definition.id, initialStage: "collect" },
  ),
});

const assignment = await router.assign(input, { idempotencyKey: submissionKey });
// Assignment and initial job committed together; redirect immediately.

const worker = createWorkflowWorker({ store: store.workflows, definition });
await worker.run({ signal: shutdownSignal });
// Or await worker.runOnce().
```

Each handler returns JSON output and an explicit transition: `next`, `wait` or
`complete`. Outputs are saved by step name. The runtime supports an acyclic
sequence with branches; revisiting a completed step is rejected. Use a new workflow
for a new revision. Workers claim only their definition ID. Keep IDs versioned and
retain the matching implementation for in-flight jobs.

## Approval

A handler can return:

```ts
return {
  output: { proposedChanges },
  transition: { type: "wait", stage: "publish" },
};
```

The record remains in `awaiting_approval` without a process waiting. The application
authenticates the reviewer and validates the resolution, then calls:

```ts
store.workflows.resolve(id, { approved: true, actor: authenticatedUser.id });
```

Resolution is arbitrary JSON, exposed as `workflow.resolution` to the resumed step.
The store does not interpret approval policy. Approval waits have no automatic
expiry. Applications can inspect `list({ status: "awaiting_approval" })` and
`get(id)`. Failed jobs can be retried explicitly with `retry(id)`.

## Reliability and privacy

- Immediate transactions atomically save assignment/job, result/next step and
  resolution/resume step. Network calls run outside transactions.
- Claims have expiring leases and unique fencing tokens. Expired workers cannot
  mutate newer claims. Workers automatically renew leases while a handler runs.
- Defaults: 60-second lease, 5-minute per-step deadline, three attempts, 5-second
  retry delay. These are worker options. Exhausted jobs fail closed.
- Execution is **at least once**. A stable per-step idempotency key is supplied,
  but an external service must support deduplication or the handler must reconcile
  uncertain writes. A completed step's output prevents rerunning it normally;
  a crash between an external write and saving that output can repeat the write.
- Cancellation is cooperative. Pass the signal to providers and enforce a sandbox
  deadline. SQLite fencing cannot stop an external write by an uncooperative handler.
- Context and outputs are explicitly persisted JSON, not automatically redacted.
  Do not store credentials. Minimize personal data; retention and encryption remain
  application responsibilities. Raw form input is not copied automatically.
- Retries keep the initial context and assignment. Historical assignments created
  without a workflow are not backfilled. Calendar bookings and rotation cursors
  are not changed by workflow transitions.
- Use a local filesystem on one host, not a network filesystem. Worker failures
  store generic messages rather than provider bodies that might expose secrets.

## Contact-sales example and migration

`apps/demo/src/lead-workflow.ts` owns the example's research → notify →
optional approval → CRM policy and its research report shape. Its presentation
helper keeps the dashboard's existing research/resolution view unchanged.
`update-attio.ts` is an ordinary step dependency, not part of this runtime.

Schema v4 migrates v3 jobs to definition `contact-sales-v1`, moves their saved
research to `outputs.research`, and preserves approvals and assignments.
Expired/running legacy work is made pending with old claims invalidated. Stop old
workers before upgrading; do not run v3 and v4 implementations against one database.

Run the entirely offline example:

```sh
npm run workflow:demo --workspace=@open-routing/demo
```

The local HTTP example uses demo research and the real Attio adapter against an
in-memory transport. No live Attio writes occur. The SDK worker defaults to three
attempts; the example uses one so its failure scenario is visible for manual retry.
