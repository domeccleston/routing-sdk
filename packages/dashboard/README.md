# @open-routing/dashboard

Read-only local admin UI, served by the host at `/admin`. `dashboardAsset()`
resolves allow-listed assets; the host supplies `/admin/api/submissions` using
`DecisionStore.list()`. Contains no CRM calls, database driver, or example fixtures.

Displays submissions, decision snapshots, provider data and rule traces. Status
filtering and pagination are server-backed; the list refreshes every five seconds.
