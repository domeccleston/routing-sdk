# @open-routing/dashboard

Local admin UI, served by the host at `/admin`. `dashboardAsset()`
resolves allow-listed assets; the host supplies `/admin/api/submissions` using
`DecisionStore.list()`. Contains no CRM calls, database driver, or example fixtures.

Displays submissions, decision snapshots, provider data and rule traces. Status
filtering and pagination are server-backed; the list refreshes every five seconds.

Submission records may include a `workflow` (or null for historical/invalid
submissions). The detail panel shows research, sources, proposed changes, resolution
and workflow status. The host supplies a `csrfToken` in the list response and
protected JSON POST endpoints at `/admin/api/workflows/:id/resolve` and `/retry`.
Resolve accepts `{ action: "accept-changes" | "keep-initial", note: string }`;
retry accepts `{}`. Requests send `X-Admin-Token`. The host must authenticate and
authorize these actions; the example is single-user localhost only, uses a per-server
capability token plus exact Origin checks, and records the actor as `local-admin`.
This is not production authentication. No external messaging or CRM writes occur
in the example. Research is labelled as fixture output. Polling does not replace
the detail panel while a review control has focus or an action is pending.

`/admin/pools` shows round-robin state using `GET /admin/api/pools`, which the host
implements with `router.listPoolStates()` and returns as `{ pools }`. It displays
the next person, last assigned person, upcoming active-member order, and inactive
members. Reads never consume a turn. It refreshes every five seconds and labels
failed-refresh data as potentially stale. Next-up is a snapshot, not a reservation.

`/admin/analytics` uses `GET /admin/api/analytics` to show all-time enriched company
size, industry, HQ country, domain-grouped company records, and rep assignments.
The example uses `store.analytics(reps)` to include named reps with zero assignments.
Refreshes every 30 seconds. Confirmed bookings are explicitly **not tracked**:
redirecting to a calendar is not evidence that a booking occurred.
