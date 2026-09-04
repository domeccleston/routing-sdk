---
title: "Decision records"
description: "Explain an assignment and distinguish it from a submission or a booked meeting."
---

## Three events, different meanings

A **submission** is an attempt to send a form. An **assignment** is a committed
routing result. A **booking** is a confirmed scheduling event. Multiple submission
attempts can share one assignment; an assignment does not prove that a booking occurred.

## Read an assignment

Use `outcome`, `personId`, `poolId`, and `ruleId` to identify what happened.
`redirectUrl` tells the host where to send the visitor. `facts` captures normalized
provider results; `trace` explains the leaf conditions evaluated before the result.
`warnings` records provider availability and owner-eligibility issues.

A trace follows configured rule order. An ineligible owner may have a matching
condition in the trace even though a later pool rule supplied the final assignment.
See the [result reference](/reference/router#result) for every field.

## Submission lifecycle

A `SubmissionRecord` starts as `pending` and ends as `completed` or `failed`.
Completed means routing finished, including an unassigned result. Final records
cannot be overwritten through the store API. Interrupted requests can remain pending.

| Field                                 | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `id`, `receivedAt`                    | Submission identity and arrival time            |
| `status`, `completedAt`, `durationMs` | Processing lifecycle                            |
| `configVersion`                       | Host-supplied configuration fingerprint         |
| `input`                               | Declared fields after privacy filtering         |
| `decision`                            | Assignment snapshot, facts, trace, and warnings |
| `error`                               | Safe failure code and invalid field names       |

The example fingerprints its configuration and fixtures. Each HTTP attempt has its
own record; retries can contain the same assignment ID. The store offers detail
lookup, status filtering, pagination, and newest-first lists.

## Privacy boundary

The SQLite submission store applies the schema's privacy policy: omitted and
undeclared input fields are dropped, masked fields and private rule operands are
redacted. Raw form input is not duplicated inside the assignment snapshot.
Normalized provider facts, including CRM owner identity, remain visible to the
administrator. Privacy flags are not encryption or a retention policy.

The local database is not encrypted by the SDK. Keep it outside Git and restrict
access to both its files and the dashboard. The example uses
`apps/demo/.data/routing.sqlite`.

## Assignment and audit failures

Assignment persistence is mandatory: a failure must prevent a successful routing
redirect. Audit logging is separate and best-effort in the example; a logging failure
can leave an attempt missing or pending without losing a committed assignment.
See [storage guarantees](/reference/storage).

<div className="planned-feature">
  <span className="planned-label">Planned · Data lifecycle</span>
  <h2>Retention, deletion, and booking reconciliation</h2>
  <p>Configure retention periods, delete stored personal data, and join scheduling
  events to assignment records. These controls and booking reconciliation are not
  implemented as a supported end-to-end workflow.</p>
</div>
