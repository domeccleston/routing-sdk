# Honor an existing CRM owner

Existing ownership takes priority without advancing the new-account pool. Offline output assigns Bob, with Alice still next.

For a read-only Attio lookup, set `ATTIO_LIVE=1`, `ATTIO_API_KEY`, `ATTIO_WORKSPACE_MEMBER_ID`, and `COMPANY_DOMAIN`. The configured member should own that company. Root `.env.local` is loaded automatically. No CRM writes are performed.

From the repository root, after `pnpm install`:

```sh
pnpm --filter @open-routing/example-crm-ownership run start
```

Read [index.ts](index.ts) for the complete scenario. The in-memory SQLite store resets on each run.
