---
title: "Submission and decision model"
description: "Record lifecycle, privacy filtering, and local persistence limitations."
---

# Submission and decision model

One `SubmissionRecord` represents a received form POST. Its ID exists before
validation and provider calls; the routing decision has its own ID, linked by
the embedded snapshot.

Lifecycle: `pending` → `completed` or `failed`. Completed means routing finished,
not that a meeting was booked. New decisions are assigned or unassigned. Legacy
routed/not-routed/unresolved snapshots remain readable. Final records cannot be overwritten.

Fields:

- `id`, `receivedAt`: submission identity and arrival time.
- `status`, `completedAt`, `durationMs`: processing lifecycle.
- `configVersion`: SHA-256 fingerprint of the example configuration and routing fixtures.
- `input`: declared form fields after privacy filtering.
- `decision`: outcome, selected rule, pool, person, redirect URL, normalized provider facts,
  evaluated rule trace, warnings, and decision ID. The raw input is not duplicated.
- `error`: safe error code and invalid field names; never exception messages or credentials.

SQLite stores a versioned JSON record alongside indexed ID, status, and received
time columns. `PRAGMA user_version` tracks schema version (currently 2).
The store supports detail lookup, status filtering, pagination, and newest-first lists.

Privacy is enforced again at the storage boundary: undeclared/omitted fields are
dropped; masked fields and private rule operands are redacted. Normalized provider
facts (including CRM owner identity) remain visible to the local administrator.
The database is not encrypted. No retention policy or deletion UI is implemented yet.

The example database is `examples/contact-sales/.data/routing.sqlite`, ignored by
Git. There is no backfill of earlier requests and no fabricated dashboard data.
Pending records survive interrupted processes; they are not falsely marked completed.

The example server binds to loopback. `/admin` and its read-only API reject foreign
Host headers and disable caching. This is a local admin tool, not production
authentication: do not expose it via a tunnel or reverse proxy without access control.

Assignment persistence is mandatory: the `assignments` table stores an immutable
result by idempotency key, and `pool_rotations` stores the last selected person per
pool. Selection, advancement, and saving happen in one SQLite write transaction.
An assignment storage failure prevents redirecting and returns HTTP 503.

Submission audit logging is separate and best-effort. Logging errors are recorded
without input contents; these attempts may be missing or pending in the dashboard,
but cannot lose a committed assignment or advance its rotation again.
Every POST attempt gets its own submission record; retries share one assignment ID.
The form gets a hidden `_submissionId` per page load, stripped before schema validation.
API callers may supply `Idempotency-Key`; it takes precedence over the hidden key.
Loading a fresh form starts a new opportunity. Reusing a key returns its original
assignment even if fields change. Keys are not authentication tokens.

Booking confirmation and webhook ingestion are separate future work.
