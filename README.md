# Open Routing

An open-source routing engine for contact-sales forms. This repository is at
the contract-design stage: the example data and tests define the first problem
the SDK will solve.

## Repository structure

```text
packages/
  core/                 Typed schemas, provider contracts, and routing engine
  attio/                Attio CRM ownership provider
  store-sqlite/         Durable local submission and decision records
  dashboard/            Reusable read-only admin UI
examples/
  contact-sales/        Self-contained form, fixtures, server, and tests
```

Production packages do not import from `examples`. Each integration owns its
implementation and contract tests; each example owns its demo data and UI.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm test
npm run typecheck
npm run dev
```

The example form is served at <http://localhost:3000>. Its POST handler parses
the strongly typed form, resolves fixture enrichment and CRM ownership, applies
the routing policy, and issues a `303` directly to Cal.com or the success page.

The minimum SDK lives in `packages/core`, and the Attio adapter lives in
`packages/attio`. The example router configuration is
`examples/contact-sales/router.config.ts`.

## Contact-sales example

- `examples/contact-sales/fixtures/routing`: form schema, representatives,
  territories, and ordered rules.
- `examples/contact-sales/fixtures/attio`: deterministic CRM and enrichment data.
- `examples/contact-sales/fixtures/routing/scenarios.ts`: shared form presets and end-to-end expected decisions.

Default tests make no network requests. Live Attio contract tests will be
opt-in via `RUN_ATTIO_INTEGRATION_TESTS=1` and `ATTIO_API_KEY`.

No credential is committed. Export it in the shell or place it in the ignored
root `.env.local` file before running `npm run test:attio`.

## Local dashboard

With `npm run dev` running, open <http://localhost:3000/admin>. New form submissions
are stored in SQLite and shown with their decisions and provider data. See
[the data model](docs/decision-records.md) for privacy and lifecycle details.

## Documentation

The Mintlify site lives in `docs/`. Preview it at <http://localhost:3001>:

```sh
npm run docs:dev
```

Run `npm run docs:check` to validate the site and check internal links. These
commands download and run a pinned Mintlify CLI on first use.

For Mintlify project `6a9a82f204bdc285e8c8bca2`, configure
[Mintlify Git Settings](https://app.mintlify.com) with
repository `domeccleston/routing-sdk`, the branch containing the docs, and
documentation directory `docs`. The Mintlify GitHub App must have access to this
repository. Push the docs to the configured branch to trigger a deployment.
The project ID is dashboard metadata; it does not belong in `docs.json`.
