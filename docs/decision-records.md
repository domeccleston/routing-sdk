# Submission and decision model

One `SubmissionRecord` represents a received form POST. Its ID exists before
validation and provider calls; the routing decision has its own ID, linked by
the embedded snapshot.

Lifecycle: `pending` → `completed` or `failed`. Completed means routing finished,
not that a meeting was booked. A completed decision may be routed, not routed,
or unresolved. Final records cannot be overwritten through the store API.

Fields:

- `id`, `receivedAt`: submission identity and arrival time.
- `status`, `completedAt`, `durationMs`: processing lifecycle.
- `configVersion`: SHA-256 fingerprint of the example configuration and routing fixtures.
- `input`: declared form fields after privacy filtering.
- `decision`: outcome, selected rule/territory, destination, normalized provider facts,
  evaluated rule trace, warnings, and decision ID. The raw input is not duplicated.
- `error`: safe error code and invalid field names; never exception messages or credentials.

SQLite stores a versioned JSON record alongside indexed ID, status, and received
time columns. `PRAGMA user_version` tracks schema version (currently 1).
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

Persistence errors are logged without submission contents and never prevent a
successful routing redirect. Such attempts may be missing or remain pending in
the dashboard. Booking confirmation and webhook ingestion are separate future work.
