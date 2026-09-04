# Open Routing

An open-source routing engine for contact-sales forms. This repository is at
an early implementation stage, with durable round-robin lead assignment and a
local demo and dashboard.

## Repository structure

```text
packages/
  open-routing/         Top-level router with persistent SQLite by default
  core/                 Typed schemas, provider contracts, and routing engine
  attio/                Attio CRM ownership provider
  pdl/                  People Data Labs company enrichment provider
  store-sqlite/         Assignments, round-robin state, submissions, and durable lead workflows
  dashboard/            Local admin UI with research review controls
  research/             Company research agents, sandbox sessions and routing review
apps/
  demo/                 Complete form, dashboard, fixtures, and workflow integration
examples/
  round-robin/          Rotate between people and retry safely
  territories/         Select a territory and rotate within its pool
  crm-ownership/        Prefer an existing CRM owner
  enrichment/           Route using enriched company size
  research/             Research a company with a sandboxed agent
  workflow-approval/    Pause background work for human review
```

Production packages do not import from `examples` or `apps`. Each example is an
independent, single-scenario program. See [the examples](examples/README.md) for
run commands and prerequisites. The [demo application](apps/demo/README.md)
combines these capabilities into a full contact-sales flow.

## Development

Start with `import { createRouter } from "open-routing"`. See the
[top-level API](packages/open-routing/README.md) for defaults and storage overrides.

Requires Node.js 22 or newer and pnpm 10.20.0 (pinned in `packageManager`).
If using Corepack, run `corepack enable` first.

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run dev
```

CI uses `pnpm install --frozen-lockfile`. Internal dependencies use `workspace:*`;
workspace membership and allowed native dependency builds are configured in
`pnpm-workspace.yaml`. Do not generate an npm lockfile for this repository.

The example form is served at <http://localhost:3000>. Its POST handler parses
the strongly typed form, resolves fixture enrichment and CRM ownership, applies
the routing policy, and issues a `303` directly to Cal.com or the success page.

The minimum SDK lives in `packages/core`, and the Attio adapter lives in
`packages/attio`. The example router configuration is
`apps/demo/router.config.ts`.

## Demo application

- `apps/demo/fixtures/routing`: form schema, representatives,
  and territories. Ordered rules live in `router.config.ts`.
- `apps/demo/fixtures/attio`: deterministic CRM and enrichment data.
- `apps/demo/fixtures/routing/scenarios.ts`: shared form presets and end-to-end expected decisions.

Default tests make no network requests. Live Attio contract tests will be
opt-in via `RUN_ATTIO_INTEGRATION_TESTS=1` and `ATTIO_API_KEY`.

No credential is committed. Export it in the shell or place it in the ignored
root `.env.local` file before running `pnpm run test:attio`.

## Local dashboard

For live company enrichment, export `PDL_API_KEY` before running `pnpm run dev`.
Without it the example remains fixture-only. See [the PDL adapter](packages/pdl/README.md)
for configuration, normalized fields, and matching behavior. Default tests never call PDL.

With `pnpm run dev` running, open <http://localhost:3000/admin>. New form submissions
are stored in SQLite and shown with their decisions and provider data. See
[the data model](docs/decision-records.md) for privacy and lifecycle details.
The [pools view](http://localhost:3000/admin/pools) shows each round-robin's next
person, last assignment, active rotation order, and inactive members.
The [analytics view](http://localhost:3000/admin/analytics) summarizes company size,
industry, HQ country, and rep assignments. Booking confirmations are not tracked yet.

## Documentation

### Live Attio end-to-end run

`pnpm run dev:attio` loads `.env.local` and enables real Attio reads/writes.
Set `ATTIO_API_KEY` and `ATTIO_WORKSPACE_MEMBER_ID` (the example maps its sample
reps to this one real member). The workspace must have single-value text attributes
`routing_research` and `routing_qualification`, plus `account_owner`.
Research and notifications remain simulated. Live jobs use a separate definition
ID so switching modes cannot send old demo jobs to Attio.

For a labelled, repeatable test, run the server with `PORT=3002`,
`ATTIO_E2E_DOMAIN=routing-sdk-e2e-YOUR-RUN.example.com` and a separate
`ROUTING_DB_PATH`. Then run `pnpm run test:attio:e2e` with the same domain and
member ID. It submits the form, verifies the calendar redirect and approval hold,
approves the test proposal, reads back the real Attio owner/research/qualification,
and checks replay deduplication. It retains the labelled company for inspection.
Attio rejects the `.example` TLD; this runner uses a subdomain of reserved
`example.com`. Tests in `pnpm run check` remain offline.

For opt-in background research, notification, approval and CRM stages, see
[the research SDK](packages/research/README.md) and
[SQLite lead workflows](packages/store-sqlite/README.md). Run the offline example:

```sh
pnpm --filter @open-routing/demo run workflow:demo
```

The HTTP example now queues fixture research with every valid assignment and runs
a background worker. Choose a research fixture on the form: clean, proposed changes,
or failure. In `/admin`, select the submission to read the report, accept/reject
changes with a review note, or retry failed research. The failure fixture recovers
on manual retry. Existing submissions are not backfilled. Calendar redirects stay
immediate; accepting changes does not change an existing booking.

Both examples use simulated notifications and the Attio adapter with an in-memory
demo transport; they make no external writes. The step sequence and approval policy
live in `apps/demo/src/lead-workflow.ts`, not in SQLite. Applications
supply their own agent, messaging and CRM steps. The local admin's
token and same-origin guards are not a replacement for production authentication.

The Mintlify site lives in `docs/`. Preview it at <http://localhost:3001>:

```sh
pnpm run docs:dev
```

Run `pnpm run docs:check` to validate the site and check internal links. These
commands download and run a pinned Mintlify CLI on first use.

For Mintlify project `6a9a82f204bdc285e8c8bca2`, configure
[Mintlify Git Settings](https://app.mintlify.com) with
repository `domeccleston/routing-sdk`, the branch containing the docs, and
documentation directory `docs`. The Mintlify GitHub App must have access to this
repository. Push the docs to the configured branch to trigger a deployment.
The project ID is dashboard metadata; it does not belong in `docs.json`.

## Code quality

Run `pnpm run check` for all checks (Oxlint, Oxfmt, Knip, TypeScript, and tests).
The same command runs in GitHub Actions; live Attio tests are excluded.

| Command                 | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `pnpm run lint`         | Lint all workspaces; warnings fail the check    |
| `pnpm run lint:fix`     | Apply safe lint fixes                           |
| `pnpm run format`       | Format source, markup, styles, config, and docs |
| `pnpm run format:check` | Check formatting without modifying files        |
| `pnpm run knip`         | Find unused files, exports, and dependencies    |

Knip uses package exports as SDK entry points and explicitly includes browser
scripts and package tests. Generated files and local databases are excluded.
