# @open-routing/dashboard

Read-only local admin UI, served by the host at `/admin`. `dashboardAsset()`
resolves allow-listed assets; the host supplies `/admin/api/submissions` using
`DecisionStore.list()`. Contains no CRM calls, database driver, or example fixtures.

Displays submissions, decision snapshots, provider data and rule traces. Status
filtering and pagination are server-backed; the list refreshes every five seconds.

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
